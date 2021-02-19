const { EventEmitter } = require('events');
const oracledb = require('oracledb');
const dbconfig = require('./dbconfig');

const METHODS_REQUIRING_CONNECTION = ['doExecute', 'doExecuteMany'];
const deactivate = Symbol('deactivate');

class InitializedState {
  constructor(db) {
    this.dbsPool = db.dbsPool;
  }

  async doExecute(poolAlias, statement, binds = [], opts = {}) {
    return new Promise(async (resolve, reject) => {
        let conn;
        opts.outFormat = oracledb.OBJECT;
        opts.autoCommit = true;
        try {
          conn = await oracledb.getConnection(this.dbsPool[poolAlias]);
          const result = await conn.execute(statement, binds, opts);
          resolve(result);
        }
        catch (err) { reject({ error: err }); }
        finally {
          if (conn) {
            try {
              await conn.close();
            } catch (err) { 
              console.log(err);
            }
          }
        }
      }
    );
  }

  async doExecuteMany(poolAlias, statement, binds = [], opts = {}) {
    return new Promise(async (resolve, reject) => {
      let conn;
      opts.outFormat = oracledb.OBJECT;
      opts.autoCommit = true;
      opts.batchErrors = true;
      try {
        conn = await oracledb.getConnection(this.dbsPool[poolAlias]);
        const result = await conn.executeMany(statement, binds, opts);
        resolve(result);
      }
      catch (err) { reject(err); }
      finally {
        if (conn) {
          try { 
            await conn.close();
          } catch (err) {
            console.log(err);
          }
        }
      }
    });
  }
}

class QueuingState {
  constructor(db) {
    this.db = db;
    this.commandsQueue = [];

    METHODS_REQUIRING_CONNECTION.forEach(methodName => {
      this[methodName] = function (...args) {
        console.log('Command queued:', methodName, args);
        return new Promise((resolve, reject) => {
          const command = () => {
            db[methodName](...args)
              .then(resolve, reject);
          };
          this.commandsQueue.push(command);
        });
      };
    });
  }

  [deactivate]() {
    this.commandsQueue.forEach(command => command());
    this.commandsQueue = [];
  }
}

class DB extends EventEmitter {
  constructor() {
    super();
    this.dbsPool = {};
    this.state = new QueuingState(this);
  } 

  async initialize() {
    try {
      for (let db of Object.keys(dbconfig)) {
        let config = dbconfig[db];
        this.dbsPool[config.poolAlias] = await oracledb.createPool(config);
      }
      
      this.initialized = true;
      this.emit('initialized');
      const oldState = this.state;
      this.state = new InitializedState(this);
      oldState[deactivate] && oldState[deactivate]();
    } catch (err) {
      console.log(err);
    }
  }

  async doExecute(poolAlias, statement, binds = [], opts = {}) {
    return this.state.doExecute(poolAlias, statement, binds, opts);
  }

  async doExecuteMany(poolAlias, statement, binds = [], opts = {}) {
    return this.state.doExecuteMany(poolAlias, statement, binds, opts);
  }

  async close() {
    try {
      for (let db of Object.keys(dbconfig)) {
        await oracledb.getPool(dbconfig[db].poolAlias).close();
      }
    }
    catch (err) {
      console.log(err);
    }
  }
}

module.exports = new DB();
