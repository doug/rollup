import { FSWatcher, WatchOptions } from 'chokidar';
import * as fs from 'fs';
import chokidar from './chokidar';
import { Task } from './index';

const opts = { encoding: 'utf-8', persistent: true };

const watchers = new Map<string, Map<string, FileWatcher>>();

export function addTask(
	id: string,
	task: Task,
	chokidarOptions: WatchOptions,
	chokidarOptionsHash: string,
	isTransformDependency: boolean
) {
	if (!watchers.has(chokidarOptionsHash)) watchers.set(chokidarOptionsHash, new Map());
	const group = watchers.get(chokidarOptionsHash);

	let watcher: FileWatcher = group.get(id);
	if (!watcher) {
		watcher = new FileWatcher(id, chokidarOptions, () => {
			group.delete(id);
		});

		if (watcher.fileExists) {
			group.set(id, watcher);
		} else {
			return;
		}
	}

	if (isTransformDependency) watcher.transformDependencyTasks.add(task);
	else watcher.tasks.add(task);
}

export function deleteTask(id: string, target: Task, chokidarOptionsHash: string) {
	const group = watchers.get(chokidarOptionsHash);

	const watcher = group.get(id);
	if (watcher) {
		let deleted = watcher.tasks.delete(target);
		deleted = watcher.transformDependencyTasks.delete(target) || deleted;

		if (deleted && watcher.tasks.size === 0 && watcher.transformDependencyTasks.size === 0) {
			watcher.close();
			group.delete(id);
		}
	}
}

export default class FileWatcher {
	fileExists: boolean;
	fsWatcher: FSWatcher | fs.FSWatcher;
	tasks: Set<Task>;
	transformDependencyTasks: Set<Task>;

	constructor(id: string, chokidarOptions: WatchOptions, dispose: () => void) {
		this.tasks = new Set();
		this.transformDependencyTasks = new Set();

		let mtime = -1;

		try {
			const stats = fs.statSync(id);
			mtime = +stats.mtime;
			this.fileExists = true;
		} catch (err) {
			if (err.code === 'ENOENT') {
				// can't watch files that don't exist (e.g. injected
				// by plugins somehow)
				this.fileExists = false;
				return;
			} else {
				throw err;
			}
		}

		const handleWatchEvent = (event: string) => {
			if (event === 'rename' || event === 'unlink') {
				this.fsWatcher.close();
				this.trigger(id);
				dispose();
			} else {
				let stats: fs.Stats;
				try {
					stats = fs.statSync(id);
				} catch (err) {
					if (err.code === 'ENOENT') {
						if (mtime !== -1) {
							mtime = -1;
							this.trigger(id);
						}
					}
					throw err;
				}
				// debounce
				if (+stats.mtime - mtime > 50) this.trigger(id);
			}
		};

		if (chokidarOptions) {
			this.fsWatcher = chokidar.watch(id, chokidarOptions).on('all', handleWatchEvent);
		} else {
			this.fsWatcher = fs.watch(id, opts, handleWatchEvent);
		}
	}

	close() {
		this.fsWatcher.close();
	}

	trigger(id: string) {
		this.tasks.forEach(task => {
			task.makeDirty(id, false);
		});
		this.transformDependencyTasks.forEach(task => {
			task.makeDirty(id, true);
		});
	}
}
