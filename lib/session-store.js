/** express-session store backed by the app's SQLite DB (replaces the leaky MemoryStore). */
const session = require("express-session");
const { db } = require("./db");

db.exec(`CREATE TABLE IF NOT EXISTS sessions (sid TEXT PRIMARY KEY, sess TEXT NOT NULL, expires INTEGER NOT NULL)`);
const DEFAULT_TTL = 7 * 24 * 60 * 60 * 1000;

class SqliteStore extends session.Store {
  constructor() {
    super();
    this.q = {
      get: db.prepare("SELECT sess, expires FROM sessions WHERE sid = ?"),
      set: db.prepare("INSERT INTO sessions (sid, sess, expires) VALUES (?, ?, ?) ON CONFLICT(sid) DO UPDATE SET sess = excluded.sess, expires = excluded.expires"),
      del: db.prepare("DELETE FROM sessions WHERE sid = ?"),
      touch: db.prepare("UPDATE sessions SET expires = ? WHERE sid = ?"),
      gc: db.prepare("DELETE FROM sessions WHERE expires < ?"),
    };
    setInterval(() => { try { this.q.gc.run(Date.now()); } catch (_) {} }, 15 * 60 * 1000).unref();
  }
  exp(sess) { const e = sess && sess.cookie && sess.cookie.expires; return e ? new Date(e).getTime() : Date.now() + DEFAULT_TTL; }
  get(sid, cb) {
    try {
      const row = this.q.get.get(sid);
      if (!row) return cb(null, null);
      if (row.expires < Date.now()) { this.q.del.run(sid); return cb(null, null); }
      cb(null, JSON.parse(row.sess));
    } catch (e) { cb(e); }
  }
  set(sid, sess, cb) { try { this.q.set.run(sid, JSON.stringify(sess), this.exp(sess)); cb && cb(null); } catch (e) { cb && cb(e); } }
  destroy(sid, cb) { try { this.q.del.run(sid); cb && cb(null); } catch (e) { cb && cb(e); } }
  touch(sid, sess, cb) { try { this.q.touch.run(this.exp(sess), sid); cb && cb(null); } catch (e) { cb && cb(e); } }
}
module.exports = { SqliteStore };
