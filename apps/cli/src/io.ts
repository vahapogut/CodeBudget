/** Read bounded stdin without loading any other CodeBudget module. */
export async function readStdin(maxBytes = 2 * 1024 * 1024): Promise<string> {
  const chunks: Buffer[] = []; let size = 0;
  for await (const value of process.stdin) {
    const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
    size += chunk.length;
    if (size > maxBytes) throw new Error('Input exceeds limit');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}
