/** worker_threads 진입점. 앱 DB 핸들은 부모와 공유하지 않는다. */
import { workerData } from "node:worker_threads";
import { runQueuedJobs } from "./jobs";

const opts = workerData as { appDbPath: string; dataDir: string };
runQueuedJobs(opts.appDbPath, opts.dataDir);
