import { spawnSync } from 'node:child_process';

const url =
  'https://embed-api.clickhost.xyz/embed/stream/8239417?token=c3RyZWFtOjgyMzk0MTc6MTc4NjQ3OTk1ODo0MzFiYWIxMTQ3OGQyYTE5OTQ1NTFiY2U1ZTEyOGMwOGNiMmIzOWRmMjJkOWJkNTUxZTkxNGFlNjc1Y2NiMDBl';

const run = (label, args) => {
  const r = spawnSync('curl.exe', args, { encoding: 'utf8', timeout: 45000, windowsHide: true });
  const out = String(r.stdout || '').trim();
  console.log(`${label} ${out}`);
};

run('HTTP/1.1 (baseline):', ['-s', '-o', 'NUL', '--max-time', '20', '-w', '%{speed_download} B/s | versao %{http_version}', url]);
run('HTTP/2          :', ['--http2', '-s', '-o', 'NUL', '--max-time', '20', '-w', '%{speed_download} B/s | versao %{http_version}', url]);
