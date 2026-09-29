export function redactSecrets(value: string): string {
  return value.replace(/(https?:\/\/)[^\s/]*@/gi, '$1***@')
    .replace(/(authorization:\s*(?:basic|bearer)\s+)\S+/gi, '$1***');
}
