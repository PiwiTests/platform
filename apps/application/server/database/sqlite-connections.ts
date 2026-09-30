import type { Client, InArgs, InStatement, Transaction, TransactionMode } from '@libsql/client';

/**
 * Settings SQLite keeps per connection. libSQL's local client begins a
 * transaction on its current connection and opens a new one for every later
 * statement, so these run on each connection it opens.
 */
const CONNECTION_PRAGMAS = [
  // How long a statement waits for a write lock held by another process.
  'PRAGMA busy_timeout=5000',
  'PRAGMA synchronous=NORMAL',
  // Enforce the ON DELETE actions declared in the schema. Delete paths still
  // remove child rows explicitly (see server/utils/retention.ts) so behavior
  // does not depend on this pragma.
  'PRAGMA foreign_keys=ON',
];

/** How long a write waits for this process's open transaction before it fails. */
const TRANSACTION_WAIT_MS = 30_000;

/** Whether `promise` settles within `ms`. */
function settlesWithin(promise: Promise<void>, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(false), ms);
    void promise.then(() => {
      clearTimeout(timer);
      resolve(true);
    });
  });
}

/** Call `release` once the transaction has committed or rolled back. */
function releaseWhenClosed(tx: Transaction, release: () => void): Transaction {
  const commit = tx.commit.bind(tx);
  const rollback = tx.rollback.bind(tx);
  const close = tx.close.bind(tx);
  const releaseIfClosed = () => {
    if (tx.closed) release();
  };
  tx.commit = () => commit().finally(releaseIfClosed);
  tx.rollback = () => rollback().finally(releaseIfClosed);
  tx.close = () => {
    close();
    release();
  };
  return tx;
}

/**
 * Give every connection of a local libSQL client the same pragmas, and queue
 * its writes behind an open transaction.
 *
 * A transaction holds SQLite's write lock across awaits while the client runs
 * other statements on another connection, and the driver runs statements
 * synchronously: a write there cannot wait for the lock without blocking the
 * event loop the transaction needs to reach its COMMIT. Writes, batches and
 * other transactions therefore wait for the open transaction to end. Reads
 * (`select`) run beside it, as WAL allows.
 */
export async function configureSqliteConnections(client: Client): Promise<void> {
  const execute = client.execute.bind(client);
  const batch = client.batch.bind(client);
  const transaction = client.transaction.bind(client);
  const applyPragmas = () => Promise.all(CONNECTION_PRAGMAS.map((pragma) => execute(pragma)));

  /** Settles when the open transaction ends; null while none is open. */
  let open: Promise<void> | null = null;
  // Callers loop on `open` and run their statement right after the last check,
  // in the same tick, so no transaction can begin in between.
  const transactionEnded = async () => {
    if (open && !(await settlesWithin(open, TRANSACTION_WAIT_MS))) {
      throw new Error(`SQLite write waited ${TRANSACTION_WAIT_MS} ms for an open transaction`);
    }
  };
  const isRead = (stmt: InStatement | string) => /^\s*select\b/i.test(typeof stmt === 'string' ? stmt : stmt.sql);

  await applyPragmas();
  client.execute = async (stmt: InStatement | string, args?: InArgs) => {
    while (open && !isRead(stmt)) await transactionEnded();
    return typeof stmt === 'string' ? execute(stmt, args) : execute(stmt);
  };
  client.batch = async (stmts, mode) => {
    while (open) await transactionEnded();
    return batch(stmts, mode);
  };
  client.transaction = async (mode?: TransactionMode) => {
    while (open) await transactionEnded();
    let end!: () => void;
    const ended = new Promise<void>((resolve) => (end = resolve));
    open = ended;
    const release = () => {
      if (open === ended) open = null;
      end();
    };
    // Both start in the same tick, so the pragmas reach the connection the
    // client moves to before any other statement does.
    const [begun, configured] = await Promise.allSettled([transaction(mode), applyPragmas()]);
    if (begun.status === 'rejected') {
      release();
      throw begun.reason;
    }
    if (configured.status === 'rejected') {
      begun.value.close();
      release();
      throw configured.reason;
    }
    return releaseWhenClosed(begun.value, release);
  };
}
