/** Resolves references with at most four Git queries, preserving input order. */
export async function mapGitQueries<T, U>(values: readonly T[], query: (value: T) => Promise<U>): Promise<U[]> {
  const results = new Array<U>(values.length);
  let next = 0, failed = false;
  const worker = async () => {
    while (!failed && next < values.length) {
      const index = next++;
      try { results[index] = await query(values[index]); }
      catch (error) { failed = true; throw error; }
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, values.length) }, worker));
  return results;
}
