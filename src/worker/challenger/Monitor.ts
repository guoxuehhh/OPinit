import * as Bluebird from 'bluebird';
import { RPCSocket } from 'lib/rpc';
import { ChallengerCoinEntity, ChallengerOutputEntity, StateEntity } from 'orm';
import { getDB } from './db';
import { DataSource, EntityManager } from 'typeorm';
import { logger } from 'lib/logger';
import chalk from 'chalk';
import axios from 'axios';
import config from 'config';

export abstract class Monitor {
  public syncedHeight: number;
  protected db: DataSource;
  protected isRunning = false;

  constructor(public socket: RPCSocket) {
    [this.db] = getDB();
  }

  public async getLastOutputFromDB(manager: EntityManager): Promise<ChallengerOutputEntity[]> {
    return await manager.getRepository(ChallengerOutputEntity).find({
      order: { outputIndex: 'DESC' },
      take: 1
    });
  }

  public async getLastOutputIndex(manager:EntityManager): Promise<number> {
    const lastOutput = await this.getLastOutputFromDB(manager);
    const lastIndex = lastOutput.length == 0 ? -1 : lastOutput[0].outputIndex;
    return lastIndex;
  }

  public async getCoinTypeFromDB(l2Denom: string): Promise<string> {
    const coin = await this.db.getRepository(ChallengerCoinEntity).findOne({
      where: { l2Denom }
    });

    if (!coin) {
      throw new Error(`coin not found: ${l2Denom}`);
    }

    return coin.l1StructTag;
  }

  public async run(): Promise<void> {
    const state = await this.db.getRepository(StateEntity).findOne({
      where: {
        name: this.name()
      }
    });

    if (!state) {
      await this.db
        .getRepository(StateEntity)
        .save({ name: this.name(), height: 0 });
    }
    this.syncedHeight = state?.height || 0;

    this.socket.initialize();
    this.isRunning = true;
    await this.monitor();
  }

  public stop(): void {
    this.socket.stop();
    this.isRunning = false;
  }

  async isInvalidBlock(): Promise<boolean> {
    const res = await axios.get(`${config.L2_RPC_URI}/invalid_block`);
    return res.data['result']['height'] === '0'
  }

  public async monitor(): Promise<void> {
    if (await this.isInvalidBlock()){
      logger.info('App hash is invalid. Please check the app hash')
      process.exit(1)
    }
    while (this.isRunning) {
      try {
        const latestHeight = this.socket.latestHeight;
        if (!latestHeight || this.syncedHeight >= latestHeight) continue;
        if ((this.syncedHeight + 1) % 10 == 0 && this.syncedHeight !== 0) {
          logger.info(
            chalk[this.color()](
              `${this.name()} height ${this.syncedHeight + 1}`
            )
          );
        }

        await this.handleEvents();

        this.syncedHeight += 1;
        await this.handleBlock();

        // update state
        await this.db
          .getRepository(StateEntity)
          .update({ name: this.name() }, { height: this.syncedHeight });
      } catch (e) {
        logger.error('Monitor runs error:', e);
      } finally {
        await Bluebird.Promise.delay(100);
      }
    }
  }

  // eslint-disable-next-line
  public async handleEvents(): Promise<void> {}

  // eslint-disable-next-line
  public async handleBlock(): Promise<void> {}

  // eslint-disable-next-line
  public name(): string {
    return '';
  }

  // eslint-disable-next-line
  public color(): string {
    return '';
  }
}
