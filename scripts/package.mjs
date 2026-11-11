import { readdir, readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { resolve, join, relative } from 'node:path';
import { crc32, deflateRawSync } from 'node:zlib';
import { createHash } from 'node:crypto';

// Explicit allowlist excludes dependencies, databases, Git internals and local secrets.
const include = ['client', 'server', 'shared', 'data', 'tests', 'scripts', 'docs',
  '.gitignore', '.gitattributes', '.node-version', 'package.json', 'package-lock.json',
  'tsconfig.json', 'tsconfig.server.json', 'vite.config.ts', 'index.html',
  'PLAN.md', 'DESIGN.md', 'README.md', 'VERIFY.md'];
const root = resolve('.');
const paths = [];
async function collect(path) {
  const stat = await lstat(path);
  if (stat.isSymbolicLink()) throw new Error(`Refusing symlink: ${path}`);
  if (stat.isDirectory()) {
    for (const name of (await readdir(path)).sort()) await collect(join(path, name));
  } else if (stat.isFile()) paths.push(path);
}
for (const path of include) await collect(resolve(path));
const local = [];
const central = [];
let offset = 0;
const now = new Date();
const dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1);
const dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
for (const path of paths) {
  const filename = Buffer.from('portfolio-lab/' + relative(root, path).replaceAll('\\', '/'));
  const data = await readFile(path);
  const compressed = deflateRawSync(data);
  const checksum = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4); header.writeUInt16LE(0x800, 6); header.writeUInt16LE(8, 8);
  header.writeUInt16LE(dosTime, 10); header.writeUInt16LE(dosDate, 12);
  header.writeUInt32LE(checksum, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(filename.length, 26);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0); directory.writeUInt16LE(20, 4);
  header.copy(directory, 6, 4, 30);
  directory.writeUInt32LE(offset, 42);
  central.push(directory, filename);
  local.push(header, filename, compressed);
  offset += header.length + filename.length + compressed.length;
}
const directory = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(paths.length, 8); end.writeUInt16LE(paths.length, 10);
end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, directory, end]);
await mkdir(resolve('output'), { recursive: true });
const output = resolve('output/portfolio-lab-submission.zip');
await writeFile(output, zip);
const hash = createHash('sha256').update(zip).digest('hex');
await writeFile(resolve('output/SHA256SUMS.txt'), `${hash}  portfolio-lab-submission.zip\n`);
console.log(JSON.stringify({ output, files: paths.length, bytes: zip.length, sha256: hash }, null, 2));
