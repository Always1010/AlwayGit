/** Decode a single Git path, removing only Git's final LF terminator. */
export function gitPathOutput(output: Buffer): string {
  return output.toString('utf8').replace(/\n$/, '');
}
