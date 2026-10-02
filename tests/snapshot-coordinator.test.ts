import { expect, it, vi } from 'vitest';
import { SnapshotCoordinator } from '../src/application/snapshot-coordinator';
import type { Snapshot } from '../src/protocol/types';

function deferred(){let resolve!:(value:Snapshot)=>void,reject!:(error:Error)=>void;const promise=new Promise<Snapshot>((done,fail)=>{resolve=done;reject=fail;});return{promise,resolve,reject};}

it('redirects invalidated snapshots to the current read and keeps worktrees separate', async () => {
  const coordinator = new SnapshotCoordinator();
  const old=deferred(),current=deferred(),other=deferred();
  const query = vi.fn().mockReturnValueOnce(old.promise).mockReturnValueOnce(current.promise).mockReturnValueOnce(other.promise);
  const first = coordinator.read('a', query), duplicate = coordinator.read('a', query);
  expect(first).toBe(duplicate);
  await Promise.resolve();
  coordinator.invalidate('a');
  const afterWrite = coordinator.read('a', query), worktree = coordinator.read('b', query);
  await Promise.resolve();
  expect(query).toHaveBeenCalledTimes(3);
  expect(afterWrite).not.toBe(first); expect(worktree).not.toBe(afterWrite);
  let firstSettled=false;void first.then(()=>{firstSettled=true;});
  old.resolve({version:99} as Snapshot);await Promise.resolve();await Promise.resolve();expect(firstSettled).toBe(false);
  expect(coordinator.read('a', query)).toBe(afterWrite);
  current.resolve({version:2} as Snapshot);other.resolve({version:3} as Snapshot);
  await expect(first).resolves.toMatchObject({version:2});await expect(afterWrite).resolves.toMatchObject({version:2});await expect(worktree).resolves.toMatchObject({version:3});coordinator.dispose();
});

it('discards an invalidated failure and advances through successive invalidations without recursive result chains',async()=>{
  const coordinator=new SnapshotCoordinator(),old=deferred(),middle=deferred(),latest=deferred();
  const first=coordinator.read('repo',()=>old.promise);await Promise.resolve();coordinator.invalidate('repo');
  const second=coordinator.read('repo',()=>middle.promise);await Promise.resolve();coordinator.invalidate('repo');
  const third=coordinator.read('repo',()=>latest.promise);
  old.reject(new Error('obsolete failure'));middle.resolve({version:50} as Snapshot);latest.resolve({version:3} as Snapshot);
  await expect(first).resolves.toMatchObject({version:3});await expect(second).resolves.toMatchObject({version:3});await expect(third).resolves.toMatchObject({version:3});coordinator.dispose();
});

it('settles current and invalidated readers when the host is disposed',async()=>{
  const coordinator=new SnapshotCoordinator(),old=deferred(),current=deferred();
  const oldQuery=vi.fn(()=>old.promise),newQuery=vi.fn(()=>current.promise);
  const first=coordinator.read('repo',oldQuery),firstRejected=expect(first).rejects.toMatchObject({code:'ABORTED'});coordinator.invalidate('repo');
  const second=coordinator.read('repo',newQuery),secondRejected=expect(second).rejects.toMatchObject({code:'ABORTED'});
  coordinator.dispose();await Promise.all([firstRejected,secondRejected]);old.resolve({version:1} as Snapshot);current.resolve({version:2} as Snapshot);
  expect(oldQuery).not.toHaveBeenCalled();expect(newQuery).not.toHaveBeenCalled();
  await expect(coordinator.read('repo',async()=>({version:3} as Snapshot))).rejects.toMatchObject({code:'ABORTED'});
});
