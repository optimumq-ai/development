'use strict';
// Server-side A/V redaction "burn": given zone JSON, produce a redacted copy.
// Zone JSON shape (from the redaction workbench):
//   videoRedactions: [{ x, y, w, h, style('black'|'blur'|'pixelate'|'mosaic'), startTime, endTime }]
//   audioRedactions: [{ startTime, endTime, style('silence'|'tone'|'noise') }]
//   refWidth/refHeight (optional): coordinate space the boxes were drawn in
var cp = require('child_process');

function ffprobe(inputPath){
  var r = cp.spawnSync('ffprobe', ['-v','error','-print_format','json','-show_streams','-show_format', inputPath], { encoding:'utf8', maxBuffer: 16*1024*1024 });
  if (r.status !== 0) throw new Error('ffprobe failed: ' + (r.stderr || 'unknown'));
  var j = JSON.parse(r.stdout || '{}');
  var streams = j.streams || [];
  var v = null, a = null, i;
  for (i=0;i<streams.length;i++){ if(!v && streams[i].codec_type==='video') v=streams[i]; if(!a && streams[i].codec_type==='audio') a=streams[i]; }
  return {
    width: v ? parseInt(v.width,10) : 0,
    height: v ? parseInt(v.height,10) : 0,
    hasAudio: !!a,
    duration: parseFloat((j.format && j.format.duration) || '0') || 0
  };
}

function clampInt(n, lo, hi){ n = Math.round(n); if (n<lo) n=lo; if (n>hi) n=hi; return n; }
function fmt(n){ return (Math.round((n||0)*1000)/1000).toString(); }

function buildFilterComplex(zones, dims){
  var vw = dims.width, vh = dims.height;
  var refW = zones.refWidth || zones.sourceWidth || vw || 1;
  var refH = zones.refHeight || zones.sourceHeight || vh || 1;
  var sx = vw / refW, sy = vh / refH;

  var vids = (zones.videoRedactions || []).map(function(z){
    var x = clampInt((z.x||0)*sx, 0, Math.max(0,vw-1));
    var y = clampInt((z.y||0)*sy, 0, Math.max(0,vh-1));
    var w = clampInt((z.w||0)*sx, 1, vw - x);
    var h = clampInt((z.h||0)*sy, 1, vh - y);
    return { x:x, y:y, w:w, h:h,
      s: (z.startTime!=null?z.startTime:0),
      e: (z.endTime!=null?z.endTime:(dims.duration||999999)),
      style: (z.style||z.type||'black') };
  }).filter(function(z){ return z.w>0 && z.h>0; });

  var parts = [];
  var cur = '0:v';
  var blackChain = [];
  vids.forEach(function(z){
    if (z.style!=='blur' && z.style!=='pixelate' && z.style!=='mosaic'){
      // fail-safe: any unknown style becomes a solid black box (more redaction, not less)
      blackChain.push("drawbox=x="+z.x+":y="+z.y+":w="+z.w+":h="+z.h+":color=black:t=fill:enable='between(t,"+fmt(z.s)+","+fmt(z.e)+")'");
    }
  });
  if (blackChain.length){ parts.push('['+cur+']'+blackChain.join(',')+'[vb]'); cur='vb'; }

  var oi = 0;
  vids.forEach(function(z){
    if (z.style!=='blur' && z.style!=='pixelate' && z.style!=='mosaic') return;
    var main='m'+oi, src='s'+oi, proc='p'+oi, out='vo'+oi; oi++;
    parts.push('['+cur+']split=2['+main+']['+src+']');
    var chain;
    if (z.style==='blur'){
      chain = 'crop='+z.w+':'+z.h+':'+z.x+':'+z.y+',boxblur=20:1';
    } else {
      var bx = Math.max(2, Math.round(Math.min(z.w,z.h)/12));
      var dw = Math.max(1, Math.floor(z.w/bx)), dh = Math.max(1, Math.floor(z.h/bx));
      chain = 'crop='+z.w+':'+z.h+':'+z.x+':'+z.y+',scale='+dw+':'+dh+':flags=neighbor,scale='+z.w+':'+z.h+':flags=neighbor';
    }
    parts.push('['+src+']'+chain+'['+proc+']');
    parts.push('['+main+']['+proc+']overlay='+z.x+':'+z.y+":enable='between(t,"+fmt(z.s)+","+fmt(z.e)+")'["+out+"]");
    cur = out;
  });

  var aLabel = null;
  var aud = zones.audioRedactions || [];
  if (dims.hasAudio && aud.length){
    var ach = aud.map(function(z){
      var s=(z.startTime!=null?z.startTime:0), e=(z.endTime!=null?z.endTime:(dims.duration||999999));
      return "volume=enable='between(t,"+fmt(s)+","+fmt(e)+")':volume=0";
    }).join(',');
    parts.push('[0:a]'+ach+'[aout]'); aLabel='aout';
  }
  return { filterComplex: parts.join(';'), vLabel: cur, aLabel: aLabel, videoCount: vids.length, audioCount: aud.length };
}

function apply(opts){
  return new Promise(function(resolve, reject){
    var inputPath = opts.inputPath, outputPath = opts.outputPath, zones = opts.zones || {};
    var dims;
    try { dims = ffprobe(inputPath); } catch(e){ return reject(e); }
    if (!dims.width || !dims.height) return reject(new Error('No video stream found in input'));

    var fc = buildFilterComplex(zones, dims);
    var args = ['-y','-i', inputPath];
    if (fc.filterComplex){
      args.push('-filter_complex', fc.filterComplex);
      args.push('-map', '['+fc.vLabel+']');
    } else {
      args.push('-map','0:v');
    }
    if (fc.aLabel){ args.push('-map','['+fc.aLabel+']'); }
    else if (dims.hasAudio){ args.push('-map','0:a'); }
    args.push('-c:v','libx264','-preset','veryfast','-crf','20','-pix_fmt','yuv420p');
    if (fc.aLabel || dims.hasAudio){ args.push('-c:a','aac','-b:a','128k'); }
    args.push('-movflags','+faststart', outputPath);

    var stderr = '';
    var ff = cp.spawn('ffmpeg', args);
    ff.stderr.on('data', function(d){ stderr += d.toString(); if (stderr.length>200000) stderr = stderr.slice(-200000); });
    ff.on('error', function(e){ reject(e); });
    ff.on('close', function(code){
      if (code===0) resolve({ ok:true, dims:dims, videoCount:fc.videoCount, audioCount:fc.audioCount });
      else reject(new Error('ffmpeg exited '+code+': '+stderr.slice(-1200)));
    });
  });
}

module.exports = { apply: apply, ffprobe: ffprobe, buildFilterComplex: buildFilterComplex };

// CLI: node avRedactionApply.js <input> <output> <zones.json>
if (require.main === module){
  var fs = require('fs');
  var inp = process.argv[2], out = process.argv[3], zf = process.argv[4];
  var zones = JSON.parse(fs.readFileSync(zf,'utf8'));
  apply({ inputPath:inp, outputPath:out, zones:zones })
    .then(function(r){ console.log('DONE', JSON.stringify(r)); })
    .catch(function(e){ console.error('FAIL', e.message); process.exit(1); });
}
