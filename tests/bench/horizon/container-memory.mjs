// Run on the host: node tests/bench/horizon/container-memory.mjs IMAGE [runs=2] [requests=1000] [limit=4g].
// All texts are synthetic; output contains only aggregate measurements.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
const main = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

const image = process.argv[2];
const runs = Number(process.argv[3] ?? 2), count = Number(process.argv[4] ?? 1000);
const memoryLimit = process.argv[5] ?? '4g';
if (main && (!image || !Number.isInteger(runs) || runs < 1 || !Number.isInteger(count) || count < 20 ||
  !/^[1-9][0-9]*[gm]$/.test(memoryLimit)))
  throw new Error('Usage: node tests/bench/horizon/container-memory.mjs IMAGE [runs>=1] [requests>=20] [limit=4g]');
const docker = (...args) => execFileSync('docker', args, { encoding:'utf8', timeout:180000 }).trim();
const metrics = `
IFS= read -r current < /sys/fs/cgroup/memory.current
IFS= read -r limit < /sys/fs/cgroup/memory.max
peak=na; [ ! -r /sys/fs/cgroup/memory.peak ] || IFS= read -r peak < /sys/fs/cgroup/memory.peak
anon=na; file=na; rss=na; oom=na
while read -r key value; do case "$key" in anon) anon=$value;; file) file=$value;; esac; done < /sys/fs/cgroup/memory.stat
while read -r key value _; do case "$key" in VmRSS:) rss=$value;; esac; done < /proc/1/status
while read -r key value; do case "$key" in oom_kill) oom=$value;; esac; done < /sys/fs/cgroup/memory.events
printf '%s %s %s %s %s %s %s\\n' "$current" "$limit" "$peak" "$anon" "$file" "$rss" "$oom"
`;
function snapshot(container, completed) {
  const [current, limit, peak, anon, file, rssKiB, oomKills] =
    docker('exec', container, 'sh', '-c', metrics).split(' ');
  const mib = bytes => bytes === 'na' ? null : +(Number(bytes)/1048576).toFixed(1);
  return {completed, memoryMiB:mib(current), limitMiB:mib(limit), peakMiB:mib(peak),
    anonMiB:mib(anon), fileMiB:mib(file), rssMiB:rssKiB==='na'?null:+(Number(rssKiB)/1024).toFixed(1),
    oomKills:oomKills==='na'?null:Number(oomKills)};
}
export function synthetic(i, count) {
  const base = 'Servizio digitale di prova per il catalogo pubblico. ';
  const short = i < count * .256, medium = i < count * .768;
  const novelty = short ? 16 : medium ? 32 : 40;
  // Distinct artificial pseudo-words exercise growing-vocabulary/cache behavior.
  const tokens = Array.from({length:novelty}, (_,j)=>`zop${i.toString(36)}q${j.toString(36)}v`).join(' ');
  return base + tokens + '.';
}
async function run(series) {
  const container = `poc-memory-${randomUUID().slice(0,8)}`;
  let id, checkpoint = [], failures = 0, latencies = [], stoppedReason = null, completed = 0;
  try {
    id = docker('run','-d','--name',container,`--memory=${memoryLimit}`,`--memory-swap=${memoryLimit}`,
      '--cpus=2','-e','ANALYZER_BIND_HOST=0.0.0.0','-p','127.0.0.1::8000',image);
    const port = docker('port',id,'8000/tcp').match(/127\.0\.0\.1:(\d+)/)?.[1];
    if (!port) throw new Error('Port not mapped to loopback');
    const url = `http://127.0.0.1:${port}`;
    let ready = false;
    for (let attempt=0;attempt<120;attempt++) {
      try { if ((await fetch(url+'/health/ready')).status===200) { ready=true; break; } } catch {}
      await new Promise(resolve=>setTimeout(resolve,1000));
    }
    if (!ready) throw new Error('Service not ready after 120s');
    const send = async text => {
      const start = performance.now();
      try {
        const r = await fetch(url+'/v1/analyze', {method:'POST',headers:{'Content-Type':'application/json'},
          body:JSON.stringify({fields:[{fieldId:'description',text,allowedCategories:[]}]})});
        const reply = await r.json();
        if (r.status !== 200 || !['accepted','rejected'].includes(reply.verdict)) failures++;
      } catch { failures++; }
      latencies.push(performance.now()-start);
    };
    for (let i=0;i<20;i++) await send(synthetic(i,count)); // warmup not counted
    checkpoint.push(snapshot(id,0));
    console.error(JSON.stringify({series,checkpoint:checkpoint.at(-1)}));
    const marks = new Set([Math.round(count*.25),Math.round(count*.5),Math.round(count*.75),count]);
    let nextSample = 25;
    while (completed<count) {
      // Last 10% uses a bounded burst of four clients; one process may serialize inference.
      const batch = completed < Math.floor(count*.9) ? 1 : Math.min(4,count-completed);
      await Promise.all(Array.from({length:batch},(_,j)=>send(synthetic(completed+j,count))));
      completed += batch;
      if (completed >= nextSample || marks.has(completed) || completed === count) {
        while (nextSample <= completed) nextSample += 25;
        const point = snapshot(id,completed);
        if (marks.has(completed) || completed === count) {
          checkpoint.push(point);
          console.error(JSON.stringify({series,checkpoint:point,failures}));
        }
        // Stop before the container's hard limit; OOM is not the cleanup strategy.
        if (point.memoryMiB > point.limitMiB * .8) {
          stoppedReason = 'SOFT_MEMORY_GUARD';
          if (checkpoint.at(-1).completed !== completed) checkpoint.push(point);
          console.error(JSON.stringify({series,checkpoint:point,stoppedReason}));
          break;
        }
      }
    }
    const state = JSON.parse(docker('inspect',id,'--format','{{json .State}}'));
    const sorted = latencies.sort((a,b)=>a-b);
    return {series,image,count,completed,warmup:20,failures,stoppedReason,
      concurrencyLast10Percent:4,memoryLimit,
      latencyMsP50:+sorted[Math.floor(sorted.length*.5)].toFixed(1),
      latencyMsP95:+sorted[Math.floor(sorted.length*.95)].toFixed(1),
      checkpoints:checkpoint,oomKilled:state.OOMKilled,exitCode:state.ExitCode,
      indicativePlateau:stoppedReason===null && completed===count && checkpoint.length>=3 &&
        checkpoint.at(-1).rssMiB <= 1.2*checkpoint.find(c=>c.completed>=count*.5).rssMiB &&
        checkpoint.at(-1).anonMiB <= 1.2*checkpoint.find(c=>c.completed>=count*.5).anonMiB &&
        checkpoint.at(-1).memoryMiB < .75*checkpoint.at(-1).limitMiB && failures===0};
  } catch (error) {
    let state = null;
    if (id) {
      try { state = JSON.parse(docker('inspect',id,'--format','{{json .State}}')); } catch {}
    }
    return {series,image,count,completed,warmup:20,failures,stoppedReason:'PROBE_INTERRUPTED',
      checkpoints:checkpoint,lastCheckpoint:checkpoint.at(-1)??null,
      oomKilled:state?.OOMKilled??null,exitCode:state?.ExitCode??null,
      inspectionAvailable:state!==null,errorCode:error.code??null};
  } finally { if (id) { try { docker('rm','-f',id); } catch {} } }
}
if (main) for (let i=1;i<=runs;i++) {
  try {
    const result = await run(i);
    console.log(JSON.stringify(result));
    if (result.stoppedReason === 'PROBE_INTERRUPTED') { process.exitCode=1; break; }
  }
  catch (error) { console.error(JSON.stringify({series:i,image,error:'PROBE_INTERRUPTED',
    exitCode:error.status??null})); process.exitCode=1; break; }
}
