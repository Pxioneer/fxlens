'use client';
import {useEffect,useRef,useState} from 'react';

// Vercel Functions hard-cap request bodies at 4.5MB — stay under that, not the old 8MB.
const MAX=4*1024*1024;
// Phone camera photos routinely land above this; downscale+recompress them client-side
// instead of rejecting them or shipping a slow, oversized upload.
const COMPRESS_ABOVE=1.5*1024*1024,MAX_DIM=1800;
function compress(file){
 return new Promise((resolve,reject)=>{
  const img=new Image(),url=URL.createObjectURL(file);
  img.onload=()=>{
   const scale=Math.min(1,MAX_DIM/Math.max(img.width,img.height));
   const w=Math.round(img.width*scale),h=Math.round(img.height*scale);
   const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;
   canvas.getContext('2d').drawImage(img,0,0,w,h);
   URL.revokeObjectURL(url);
   canvas.toBlob(blob=>blob?resolve(new File([blob],'chart.jpg',{type:'image/jpeg'})):reject(new Error('Compression failed.')),'image/jpeg',0.86);
  };
  img.onerror=()=>{URL.revokeObjectURL(url);reject(new Error('Could not read that image.'))};
  img.src=url;
 });
}
export default function Home(){
 const inputRef=useRef(null),cameraRef=useRef(null);
 const [file,setFile]=useState(null),[preview,setPreview]=useState(''),[result,setResult]=useState(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
 const [symbol,setSymbol]=useState('XAUUSD'),[tf,setTf]=useState('Auto'),[notes,setNotes]=useState('');
 const [history,setHistory]=useState([]);
 useEffect(()=>{try{setHistory(JSON.parse(localStorage.getItem('fxlens-history')||'[]'))}catch{}} ,[]);
 async function pick(f){
  setError('');setResult(null);if(!f)return;
  if(!f.type.startsWith('image/'))return setError('Please select a chart image.');
  let out=f;
  if(f.size>COMPRESS_ABOVE){try{out=await compress(f)}catch{return setError('Could not process that image. Try a different screenshot.')}}
  if(out.size>MAX)return setError('Image is too large even after compression. Try a tighter crop.');
  setFile(out);
  setPreview(p=>{if(p)URL.revokeObjectURL(p);return URL.createObjectURL(out)});
 }
 function clear(){setFile(null);setPreview(p=>{if(p)URL.revokeObjectURL(p);return ''});setResult(null);setError('');if(inputRef.current)inputRef.current.value='';if(cameraRef.current)cameraRef.current.value='';}
 async function analyze(){
  if(!file)return setError('Upload a chart screenshot first.');setLoading(true);setError('');setResult(null);
  try{const fd=new FormData();fd.append('image',file);fd.append('symbol',symbol);fd.append('timeframe',tf);fd.append('notes',notes);
   const r=await fetch('/api/analyze',{method:'POST',body:fd});const raw=await r.text();let d;try{d=JSON.parse(raw)}catch{throw Error(r.status===504?'Analysis is taking too long and hit a server timeout. Try again — it usually completes faster on retry.':r.ok?'FXLens returned an unreadable response. Please try again.':`Server error (${r.status}). Please try again.`)}if(!r.ok)throw Error(d?.error||'Analysis failed.');setResult(d);
   const item={...d,id:Date.now(),created:new Date().toISOString()};const next=[item,...history].slice(0,8);setHistory(next);localStorage.setItem('fxlens-history',JSON.stringify(next));
  }catch(e){setError(e.message||'Analysis failed.')}finally{setLoading(false)}
 }
 function loadHistory(x){setResult(x);window.scrollTo({top:document.body.scrollHeight,behavior:'smooth'});}
 return <main>
  <nav><div className="brand"><span>F</span>FXLens</div><div className="navright"><span>AI CHART ANALYZER</span><b>v3</b></div></nav>
  <section className="hero"><div className="eyebrow">SCREENSHOT → STRUCTURE → SIGNAL</div><h1>Your chart.<br/><em>One clear read.</em></h1><p className="sub">Send FXLens an MT5 or TradingView screenshot. It looks only at evidence visible in the chart and returns <b>BUY, SELL, or WAIT</b> with a trade plan.</p>
   <div className="workspace">
    <div className="card upload">
     <div className="controls"><label>MARKET<select value={symbol} onChange={e=>setSymbol(e.target.value)}><option>XAUUSD</option><option>EURUSD</option><option>GBPUSD</option><option>USDJPY</option><option>BTCUSD</option><option>Other</option></select></label><label>TIMEFRAME<select value={tf} onChange={e=>setTf(e.target.value)}>{['Auto','1M','5M','15M','30M','1H','4H','1D'].map(x=><option key={x}>{x}</option>)}</select></label></div>
     {preview?<div className="preview"><img src={preview} alt="Chart preview"/><button className="remove" onClick={clear}>×</button></div>:<div className="drop" onDragOver={e=>e.preventDefault()} onDrop={e=>{e.preventDefault();pick(e.dataTransfer.files?.[0])}} onClick={()=>inputRef.current?.click()}><div className="icon">⌁</div><h3>Upload your chart</h3><p>Tap here to choose a screenshot</p><small>PNG • JPG • WEBP • large photos auto-compressed</small></div>}
     <input ref={inputRef} hidden type="file" accept="image/*" onChange={e=>pick(e.target.files?.[0])}/><input ref={cameraRef} hidden type="file" accept="image/*" capture="environment" onChange={e=>pick(e.target.files?.[0])}/>
     <div className="actions"><button className="secondary" onClick={()=>cameraRef.current?.click()}>📷 Camera</button><button className="secondary" onClick={()=>inputRef.current?.click()}>{file?'Change':'Gallery'}</button><button className="primary" disabled={!file||loading} onClick={analyze}>{loading?'Analyzing…':'Analyze →'}</button></div>
     <label className="notes">OPTIONAL NOTE<input value={notes} onChange={e=>setNotes(e.target.value)} maxLength={160} placeholder="e.g. London session, looking for a pullback"/></label>
    </div>
    <div className="card result">{loading?<Loading/>:error?<ErrorState message={error} onRetry={analyze}/>:result?<Result r={result}/>:<Empty/>}</div>
   </div>
  </section>
  {history.length>0&&<section className="history"><div className="sectionhead"><div><div className="eyebrow">LOCAL HISTORY</div><h2>Recent reads</h2></div><button onClick={()=>{setHistory([]);localStorage.removeItem('fxlens-history')}}>Clear</button></div><div className="historygrid">{history.slice(0,6).map(x=><button key={x.id} onClick={()=>loadHistory(x)} className="historyitem"><span className={x.action.toLowerCase()}>{x.action}</span><b>{x.confidence}%</b><small>{x.instrument} · {x.timeframe}</small></button>)}</div></section>}
  <section className="features"><div><b>01</b><strong>Evidence-first</strong><span>No invented live price or certainty.</span></div><div><b>02</b><strong>Trade plan</strong><span>Entry, SL, TP and reasons.</span></div><div><b>03</b><strong>WAIT is allowed</strong><span>Weak screenshots don't get forced signals.</span></div></section>
  <footer>FXLens is an analysis assistant, not a guaranteed signal service. Verify every setup and manage your own risk.</footer>
 </main>
}
function Empty(){return <div className="empty"><div className="radar">◎</div><h2>Waiting for your chart</h2><p>Upload a screenshot and FXLens will return a directional read, confidence, levels, reasons and risks.</p></div>}
function Loading(){return <div className="empty"><div className="spinner"/><h2>Reading the chart…</h2><p>Checking structure, trend, momentum, visible levels and indicators.</p></div>}
function ErrorState({message,onRetry}){return <div className="empty"><div className="erroricon">!</div><h2>Analysis failed</h2><p>{message}</p><button className="retry" onClick={onRetry}>Try again</button></div>}
function Result({r}){const a=(r.action||'WAIT').toUpperCase(),c=a.toLowerCase();return <div className="resultin"><div className="top"><div><label>FXLENS SIGNAL</label><div className={'signal '+c}>{a}</div></div><div className="conf"><span>CONFIDENCE</span><b>{Math.round(r.confidence)}%</b><i><u style={{width:`${Math.max(0,Math.min(100,r.confidence))}%`}}/></i></div></div><div className="summary">{r.summary}</div><div className="levels">{[['ENTRY',r.entry],['STOP LOSS',r.stop_loss],['TAKE PROFIT',r.take_profit]].map(([k,v])=><div key={k}><span>{k}</span><b>{v||'—'}</b></div>)}</div><div className="rr"><span>SETUP QUALITY</span><b>{r.setup_quality||'—'}</b><span>R:R</span><b>{r.risk_reward||'—'}</b></div><div className="cols"><div><h4>WHY</h4><ul>{(r.reasons||[]).map((x,i)=><li key={i}>{x}</li>)}</ul></div><div><h4>WATCH OUT</h4><ul>{(r.risks||[]).map((x,i)=><li key={i}>{x}</li>)}</ul></div></div><div className="meta">{r.instrument||'Instrument unclear'} · {r.timeframe||'Timeframe unclear'} · screenshot-based</div></div>}
