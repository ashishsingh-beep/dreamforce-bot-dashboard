// Example: Page4.js
import React, { useState, useEffect, useCallback, useRef } from 'react';
import '../styles/page4.css';
import { supabase } from '../services/supabaseClient';

export default function Stage3(){
  const [tab,setTab]=useState('scraper'); // 'scraper' | 'dashboard'
  return (
    <div className="page4-wrapper">
      <div className="tabs" style={{display:'flex',gap:8,marginBottom:12}}>
        <button type="button" className={"btn" + (tab==='scraper'? ' primary':' outline')} onClick={()=>setTab('scraper')}>Scraper</button>
        <button type="button" className={"btn" + (tab==='dashboard'? ' primary':' outline')} onClick={()=>setTab('dashboard')}>Dashboard</button>
      </div>
      {tab==='scraper'? <Stage3Scraper /> : <Stage3Dashboard />}
    </div>
  );
}

function Stage3Scraper(){
  // Shared Text Inputs
  const [wildnetData, setWildnetData] = useState('');
  const [scoringCriteriaAndIcp, setScoringCriteriaAndIcp] = useState('');
  const [messagePrompt, setMessagePrompt] = useState('');

  // Presets
  const [preset, setPreset] = useState('custom'); // 'lead_basic' | 'lead_firmo_techno' | 'custom'
  const PRESETS = {
    lead_basic: {
      label: 'Lead filtration',
      wildnetData: `About Wildnet Technologies:\n- We help B2B companies accelerate outbound by identifying high-intent prospects and crafting tailored first-touch messages.\n- Core value prop: Higher reply rates through precise ICP matching and relevant personalization.\n\nContext:\n- Use LinkedIn and public data only.\n- Avoid making assumptions not supported by the data.`,
      scoringCriteriaAndIcp: `Scoring Criteria (0–100):\n- Relevance to ICP (industry, role seniority, function) – 40\n- Clear buying signals (keywords in bio/experience) – 30\n- Company fit (size/stage, geography if available) – 20\n- Data confidence/clarity – 10\n\nIdeal Customer Profile (ICP):\n- Roles: Founders, CEOs, Heads of Growth/Marketing/Sales\n- Industries: SaaS, B2B services\n- Company size: 10–500\n\nEligibility Rules:\n- If role or company context is too generic or missing, mark ineligible.\n- If misaligned industry/function, mark ineligible.`,
      messagePrompt: `Task:\n1) Decide if the lead matches the ICP.\n2) If eligible, generate a concise, personalized first-touch message.\n\nOutput format (JSON):\n{\n  "should_contact": true|false,\n  "score": 0-100,\n  "subject": "short subject",\n  "message": "2-4 sentence DM/email with 1 relevant hook"\n}\n\nGuidelines:\n- Personalize using title, company, and visible achievements.\n- Avoid fluff; be specific and value-driven.\n- No fake familiarity; use only provided data.`
    },
    lead_firmo_techno: {
      label: 'Lead filtration + Firmographics/Technographics',
      wildnetData: `About Wildnet Technologies:\n- We provide outbound ops: prospecting, enrichment, scoring, and messaging at scale.\n\nTarget Firmographics:\n- Industries: SaaS, B2B services\n- Company size: 20–1000 employees\n- Regions: North America, Europe (if visible)\n\nTarget Technographics (if visible):\n- CRM/Marketing tools (e.g., HubSpot, Salesforce, Marketo)\n- Sales tools (e.g., Outreach, Salesloft)\n- Data tools (e.g., Snowflake, BigQuery)\n\nNotes:\n- Use only explicit data; do not infer missing technographics.`,
      scoringCriteriaAndIcp: `Scoring Criteria (0–100):\n- Role/Function Relevance – 25\n- Industry/Company Size Fit – 25\n- Technographic Fit – 25\n- Observable Buying Signals – 15\n- Data Confidence – 10\n\nEligibility Rules:\n- Missing role and company context → ineligible.\n- Clear mismatch in industry/function → ineligible.\n\nICP Summary:\n- Roles: Founders, RevOps, Growth/Marketing/Sales leaders\n- Industries: SaaS, B2B services\n- Size: 20–1000 employees`,
      messagePrompt: `Task:\n1) Evaluate lead against firmographic and technographic fit.\n2) If eligible, produce a short, tailored first-touch message.\n\nOutput (JSON):\n{\n  "should_contact": true|false,\n  "score": 0-100,\n  "subject": "short subject",\n  "message": "personalized message (2-4 sentences)"\n}\n\nMessaging Tips:\n- Reference any visible tools, growth indicators, or relevant initiatives.\n- Keep it helpful and specific; avoid generic claims.\n- No hallucinations; use only provided data.`
    },
    custom: {
      label: 'Custom',
      wildnetData: '',
      scoringCriteriaAndIcp: '',
      messagePrompt: ''
    }
  };

  const applyPreset = (key)=>{
    const tpl = PRESETS[key] || PRESETS.custom;
    setWildnetData(tpl.wildnetData);
    setScoringCriteriaAndIcp(tpl.scoringCriteriaAndIcp);
    setMessagePrompt(tpl.messagePrompt);
  };

  // Run state
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ total: 0, success: 0, failed: 0 });
  const [lastError, setLastError] = useState(null);
  const [lastResponse, setLastResponse] = useState(null);
  const [info, setInfo] = useState('');

  const [userId, setUserId] = useState(null);
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if(!mounted) return;
      if (!error) setUserId(data?.user?.id || null);
    });
    return () => { mounted = false; };
  }, []);

  const canRun = !!(wildnetData.trim() && scoringCriteriaAndIcp.trim() && messagePrompt.trim() && userId);

  async function fetchRandomApiKey(){
    // Fetch available keys and pick one randomly
    const { data, error } = await supabase.from('gemini_api').select('api_key');
    if(error) throw error;
    const rows = Array.isArray(data)? data : [];
    if(!rows.length) throw new Error('No API keys found in gemini_api');
    const idx = Math.floor(Math.random()*rows.length);
    return rows[idx].api_key;
  }

  async function fetchUnsentLeadsByUser(uid){
    // Prefer documented function name; fallback to alternate if needed
    let rpcName = 'fetch_unsent_leads_by_user';
    let { data, error } = await supabase.rpc(rpcName, { _user_id: uid });
    if(error){
      // Fallback try: fetch_unsent_leads
      rpcName = 'fetch_unsent_leads';
      const res2 = await supabase.rpc(rpcName, { _user_id: uid });
      data = res2.data; error = res2.error;
    }
    if(error) throw error;
    return Array.isArray(data)? data : [];
  }

  async function handleRun(){
    setLastError(null); setLastResponse(null); setInfo('');
    if(!canRun){ setLastError('Fill all text fields first.'); return; }
    if(!userId){ setLastError('Not signed in.'); return; }
    setRunning(true); setProgress({ total: 0, success: 0, failed: 0 });
    try{
      // 1) Leads
      const leads = await fetchUnsentLeadsByUser(userId);
      if(!leads.length){ setInfo('No unsent leads for this user.'); return; }
      setProgress(p=> ({ ...p, total: leads.length }));

      // 2) API key
      const apiKey = await fetchRandomApiKey();

      // 3) Send one request per lead
      for(let i=0;i<leads.length;i++){
        const ld = leads[i];
        const payload = {
          api_key: apiKey,
          wildnet_data: wildnetData.trim(),
          scoring_criteria_and_icp: scoringCriteriaAndIcp.trim(),
          message_prompt: messagePrompt.trim(),
          lead: {
            lead_id: ld.lead_id ?? null,
            tag: ld.tag ?? null,
            name: ld.name ?? null,
            title: ld.title ?? null,
            location: ld.location ?? null,
            company_name: ld.company_name ?? null,
            experience: ld.experience ?? null,
            skills: ld.skills ?? null,
            bio: ld.bio ?? null,
            profile_url: ld.profile_url ?? null,
            linkedin_url: ld.linkedin_url ?? null,
            company_page_url: ld.company_page_url ?? null,
          }
        };
        try{
          const res = await fetch('http://localhost:8000/process-lead', {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload)
          });
          const json = await res.json().catch(()=>({ success:false, error:'Invalid JSON response' }));
          setLastResponse(json);
          if(!res.ok){ throw new Error(json.error || `HTTP ${res.status}`); }
          setProgress(prev => ({ ...prev, success: prev.success + 1 }));
        }catch(e){
          setLastError(e.message || 'Failed for a lead');
          setProgress(prev => ({ ...prev, failed: prev.failed + 1 }));
        }
      }
    }catch(e){
      setLastError(e.message || 'Failed to run');
    }finally{
      setRunning(false);
    }
  }

  return (
    <section className="card">
      <h3 className="section-title">Shared Text Inputs</h3>
      <div className="flex-row wrap" style={{gap:8, alignItems:'center', marginBottom:8}}>
        <label>Preset<br/>
          <select value={preset} onChange={(e)=>{ const k=e.target.value; setPreset(k); applyPreset(k); }}>
            <option value="lead_basic">{PRESETS.lead_basic.label}</option>
            <option value="lead_firmo_techno">{PRESETS.lead_firmo_techno.label}</option>
            <option value="custom">{PRESETS.custom.label}</option>
          </select>
        </label>
        <div className="small muted" style={{marginTop:18}}>
          Changing preset will replace the three text fields. You can edit them afterwards.
        </div>
      </div>
      <div className="flex-row wrap">
        <div style={{flex:1,minWidth:260}}>
          <label>Wildnet Data<br/>
            <textarea value={wildnetData} onChange={e=>setWildnetData(e.target.value)} placeholder="Paste Wildnet company/context data" />
          </label>
        </div>
        <div style={{flex:1,minWidth:260}}>
          <label>Scoring Criteria & ICP<br/>
            <textarea value={scoringCriteriaAndIcp} onChange={e=>setScoringCriteriaAndIcp(e.target.value)} placeholder="Define scoring criteria & ICP" />
          </label>
        </div>
        <div style={{flex:1,minWidth:260}}>
          <label>Message Prompt / Instructions<br/>
            <textarea value={messagePrompt} onChange={e=>setMessagePrompt(e.target.value)} placeholder="Provide messaging style / personalization instructions" />
          </label>
        </div>
      </div>
      <div className="actions-row" style={{marginTop:'.75rem'}}>
        <button type="button" className="btn primary" onClick={handleRun} disabled={!canRun || running}>{running? 'Running…' : 'Run'}</button>
      </div>
      <div className="small" style={{marginTop:8}}>
        <div>Total: {progress.total} | Success: {progress.success} | Failed: {progress.failed}</div>
        {info && <div className="muted" style={{marginTop:4}}>{info}</div>}
        {lastError && <div style={{color:'crimson',marginTop:4}}>Last error: {lastError}</div>}
        {lastResponse && (
          <div style={{marginTop:8}}>
            <strong>Last response:</strong>
            <pre style={{whiteSpace:'pre-wrap',background:'#f8fafc',padding:10,border:'1px solid var(--border-color)',borderRadius:6}}>{JSON.stringify(lastResponse,null,2)}</pre>
          </div>
        )}
      </div>
    </section>
  );
}

function Stage3Dashboard(){
  const [dateFrom,setDateFrom]=React.useState('');
  const [dateTo,setDateTo]=React.useState('');
  const [loading,setLoading]=React.useState(false);
  const [rows,setRows]=React.useState([]);
  const [error,setError]=React.useState(null);
  // Unsent-to-LLM count for current user
  const [userId, setUserId] = React.useState(null);
  const [unsentCount, setUnsentCount] = React.useState(null);
  const [unsentLoading, setUnsentLoading] = React.useState(false);
  const [unsentErr, setUnsentErr] = React.useState(null);
  const [tagOptions,setTagOptions]=React.useState([]);
  const [selectedTags,setSelectedTags]=React.useState([]);
  const [tagOpen,setTagOpen]=React.useState(false);
  const selectAllRef=React.useRef(null);
  const [shouldOnly,setShouldOnly]=React.useState(false);
  const [scoreOp,setScoreOp]=React.useState('>=');
  const [scoreVal,setScoreVal]=React.useState('');
  const [locationSub,setLocationSub]=React.useState('');
  const [sortDir,setSortDir]=React.useState('desc');
  const [page,setPage]=React.useState(1);
  const pageSize=200;
  const supabaseClient = supabase;

  // Get current user id
  React.useEffect(()=>{
    let mounted=true;
    if(supabaseClient?.auth){
      supabaseClient.auth.getUser().then(({ data, error })=>{
        if(!mounted) return;
        if(!error) setUserId(data?.user?.id || null);
      });
    }
    return ()=>{ mounted=false; };
  },[supabaseClient]);

  // Load unsent leads count for this user
  const loadUnsentCount = React.useCallback(async()=>{
    if(!supabaseClient || !userId) return;
    setUnsentLoading(true); setUnsentErr(null);
    try{
      let { data, error } = await supabaseClient.rpc('fetch_unsent_leads_by_user', { _user_id: userId });
      if(error){
        const alt = await supabaseClient.rpc('fetch_unsent_leads', { _user_id: userId });
        data = alt.data; error = alt.error;
      }
      if(error) throw error;
      const count = Array.isArray(data)? data.length : 0;
      setUnsentCount(count);
    }catch(e){ setUnsentErr(e.message); }
    finally{ setUnsentLoading(false); }
  },[supabaseClient,userId]);

  React.useEffect(()=>{ loadUnsentCount(); },[loadUnsentCount]);

  // init last 14 days
  React.useEffect(()=>{
    if(!dateFrom && !dateTo){
      const now=new Date();
      const end=new Date(Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate(),23,59,59));
      const start=new Date(end.getTime()-13*24*60*60*1000);
      const fmt=d=>`${d.getUTCFullYear()}-${String(d.getUTCMonth()+1).padStart(2,'0')}-${String(d.getUTCDate()).padStart(2,'0')}`;
      setDateFrom(fmt(start)); setDateTo(fmt(end));
    }
  },[dateFrom,dateTo]);

  // load distinct tags by joining llm_response -> all_leads (llm_response itself has no tag column)
  const loadTags=React.useCallback(async()=>{
    if(!supabaseClient || !dateFrom || !dateTo) return;
    try {
      const fromIso=new Date(`${dateFrom}T00:00:00Z`).toISOString();
      const toIso=new Date(`${dateTo}T23:59:59Z`).toISOString();
      // Step 1: fetch lead_ids in date window from llm_response
      const { data: lrIds, error: lrErr } = await supabaseClient
        .from('llm_response')
        .select('lead_id')
        .gte('created_at', fromIso)
        .lte('created_at', toIso);
      if(lrErr) throw lrErr;
      const leadIds = Array.from(new Set((lrIds||[]).map(r=>r.lead_id).filter(Boolean)));
      if(!leadIds.length){ setTagOptions([]); return; }
      // Chunk to avoid URL length issues (Supabase in() limit)
      const chunkSize = 900;
      const tagsSet = new Set();
      for(let i=0;i<leadIds.length;i+=chunkSize){
        const slice = leadIds.slice(i,i+chunkSize);
        const { data: tagRows, error: tagErr } = await supabaseClient
          .from('all_leads')
          .select('tag')
          .in('lead_id', slice);
        if(tagErr) throw tagErr;
        (tagRows||[]).forEach(r=>{ if(r.tag!=null){ const t=String(r.tag).trim(); if(t) tagsSet.add(t); }});
      }
      setTagOptions(Array.from(tagsSet).sort((a,b)=>a.localeCompare(b)));
    } catch(e){ /* swallow */ }
  },[supabaseClient,dateFrom,dateTo]);
  React.useEffect(()=>{ loadTags(); },[loadTags]);

  React.useEffect(()=>{
    if(selectAllRef.current){ const all=tagOptions.length; const sel=selectedTags.length; selectAllRef.current.indeterminate = sel>0 && sel<all; }
  },[tagOptions,selectedTags]);

  async function fetchData(){
    if(!supabaseClient || !dateFrom || !dateTo) return;
    setLoading(true); setError(null);
    try{
      // Build RPC payload
      const payload={
        _date_from: dateFrom,
        _date_to: dateTo,
        _tags: selectedTags.length? selectedTags : null,
        _should_contact_only: shouldOnly,
        _score_op: scoreVal? scoreOp : null,
        _score_value: scoreVal? Number(scoreVal): null,
        _location_substr: locationSub? locationSub.trim(): null,
        _sort_dir: sortDir,
        _page: page,
        _page_size: pageSize
      };
      const { data, error } = await supabaseClient.rpc('fetch_stage3_dashboard', payload);
      if(error) throw error;
      const root = data && data[0];
      const r = Array.isArray(root?.rows)? root.rows : [];
      setRows(r);
    }catch(e){ setError(e.message); }
    finally{ setLoading(false); }
  }

  React.useEffect(()=>{ fetchData(); },[dateFrom,dateTo,selectedTags,shouldOnly,scoreOp,scoreVal,locationSub,sortDir,page]);

  function exportCsv(){
    if(!rows.length) return;
    const headers=['created_at','lead_id','tag','name','title','company_name','location','score','should_contact','subject','message'];
    const lines=[headers.join(',')];
    rows.forEach(r=>{ lines.push(headers.map(h=>`"${(r[h]??'').toString().replace(/"/g,'""')}"`).join(',')); });
    const blob=new Blob([lines.join('\n')],{type:'text/csv'}); const url=URL.createObjectURL(blob); const a=document.createElement('a'); a.href=url; a.download='stage3_dashboard.csv'; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <h2>Stage3 Dashboard</h2>
      <p className="small muted">View processed LLM scoring & messaging results.</p>
      <div className="small" style={{marginTop:4}}>
        Pending to send to LLM: {unsentLoading? '…' : (unsentCount ?? '—')}
        {unsentErr && <span style={{color:'crimson',marginLeft:8}}>({unsentErr})</span>}
      </div>
      <section className="card">
        <h3 className="section-title">Filters</h3>
        <div className="flex-row wrap filter-row" style={{gap:'0.9rem',alignItems:'flex-start'}}>
          <label>Date From<br/><input type="date" value={dateFrom} onChange={e=>{setPage(1); setDateFrom(e.target.value);} }/></label>
          <label>Date To<br/><input type="date" value={dateTo} onChange={e=>{setPage(1); setDateTo(e.target.value);} }/></label>
          <div className="tag-filter">
            <label>Tags
              <button type="button" style={{marginTop:'.55rem'}} className="btn outline" onClick={()=>setTagOpen(o=>!o)}>{selectedTags.length? `${selectedTags.length} selected` : 'Select Tags'}</button>
            </label>
            {tagOpen && (
              <div className="tag-dropdown" style={{zIndex:130}}>
                <div className="tag-dropdown-header">
                  {tagOptions.length>0 && <label><input type="checkbox" ref={selectAllRef} checked={tagOptions.length>0 && selectedTags.length===tagOptions.length} onChange={(e)=>{ if(e.target.checked) setSelectedTags([...tagOptions]); else setSelectedTags([]); }} /> Select All</label>}
                </div>
                <div className="tag-options">
                  {tagOptions.map(t=> (
                    <label key={t} className="tag-option">
                      <input type="checkbox" checked={selectedTags.includes(t)} onChange={(e)=>{ if(e.target.checked) setSelectedTags(prev=>[...prev,t]); else setSelectedTags(prev=>prev.filter(x=>x!==t)); }} /> {t}
                    </label>
                  ))}
                  {!tagOptions.length && <div className="empty small">No tags in range</div>}
                </div>
                <div className="dropdown-actions"><button className="btn xs" type="button" onClick={()=>setTagOpen(false)}>Close</button></div>
              </div>
            )}
          </div>
          <label className="should-contact-wrapper">Should Contact
            <div className="inline-checkbox">
              <input type="checkbox" checked={shouldOnly} onChange={e=>{setPage(1); setShouldOnly(e.target.checked);} } />
            </div>
          </label>
          <label>Score Filter<br/>
            <div style={{display:'flex',gap:4}}>
              <select value={scoreOp} onChange={e=>{setScoreOp(e.target.value); setPage(1);}}>
                {['>','>=','=','<=','<'].map(op=> <option key={op} value={op}>{op}</option>)}
              </select>
              <input type="number" placeholder="value" value={scoreVal} onChange={e=>{setScoreVal(e.target.value); setPage(1);}} style={{width:90}} />
            </div>
          </label>
          <label>Location<br/><input type="text" value={locationSub} placeholder="substring" onChange={e=>{setLocationSub(e.target.value); setPage(1);} } /></label>
          <label>Sort<br/>
            <select value={sortDir} onChange={e=>{setSortDir(e.target.value);}}>
              <option value="desc">Newest First</option>
              <option value="asc">Oldest First</option>
            </select>
          </label>
          <div className="self-end" style={{display:'flex',gap:6}}>
            <button type="button" className="btn primary" disabled={loading} onClick={()=>{setPage(1); fetchData();}}>{loading? 'Loading…':'Refresh'}</button>
            <button type="button" className="btn outline" disabled={!rows.length} onClick={exportCsv}>Export CSV</button>
          </div>
        </div>
        {error && <div className="small" style={{color:'crimson',marginTop:6}}>{error}</div>}
        <div className="small muted" style={{marginTop:6}}>Rows: {rows.length} (Page {page})</div>
        <div className="table-wrap" style={{marginTop:'0.75rem'}}>
          <table className="data-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Created</th>
                <th>Lead ID</th>
                <th>Tag</th>
                <th>Name</th>
                <th>Title</th>
                <th>Company</th>
                <th>Location</th>
                <th>Score</th>
                <th>Should Contact</th>
                <th>Subject</th>
                <th>Message</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r,i)=> (
                <tr key={r.lead_id+':dash:'+i}>
                  <td>{i+1}</td>
                  <td className="small" title={r.created_at}>{r.created_at?.slice(0,19).replace('T',' ')}</td>
                  <td className="truncate" title={r.lead_id}><a href={r.linkedin_url} target="_blank" rel="noreferrer">{r.lead_id?.slice(0,10)}…</a></td>
                  <td className="truncate" title={r.tag}>{r.tag}</td>
                  <td className="truncate" title={r.name}>{r.name}</td>
                  <td className="truncate" title={r.title}>{r.title}</td>
                  <td className="truncate" title={r.company_name}>{r.company_name}</td>
                  <td className="truncate" title={r.location}>{r.location}</td>
                  <td style={{textAlign:'center'}}>{r.score}</td>
                  <td style={{textAlign:'center'}}>{r.should_contact}</td>
                  <td className="truncate" title={r.subject}>{r.subject}</td>
                  <td className="truncate" title={r.message}>{r.message==='ineligible'? '—' : r.message?.slice(0,60)}</td>
                </tr>
              ))}
              {!rows.length && !loading && <tr><td colSpan={12} className="empty">No data</td></tr>}
              {loading && <tr><td colSpan={12}>Loading…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="small muted" style={{marginTop:4}}>Pagination (client): page size {pageSize}. Add true server pagination via RPC if needed.</div>
        <div style={{display:'flex',gap:6,marginTop:6}}>
          <button className="btn xs" disabled={page===1} onClick={()=>setPage(p=>Math.max(1,p-1))}>Prev</button>
          <button className="btn xs" disabled={rows.length<pageSize} onClick={()=>setPage(p=>p+1)}>Next</button>
        </div>
      </section>
    </div>
  );
}

// ---------------- Aggregated Results Table Component ----------------
// (Removed AggregatedResultsTable and batch processing related components)
