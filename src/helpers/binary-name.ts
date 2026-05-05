export function getBinaryName(): string {
  const argv1 = process.argv[1] ?? '';
  return argv1.includes('dimind') ? 'dimind' : 'mind';
}
