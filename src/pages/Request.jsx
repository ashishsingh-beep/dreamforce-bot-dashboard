import React, { useEffect, useState, useCallback } from 'react';
import '../styles/page1.css';
import { supabase } from '../services/supabaseClient';
import { Link } from 'react-router-dom';

/*
  Request Dashboard
  - Form to create a new request row in `requests` table
  Columns: request_id (uuid, default), created_at (timestamptz default), keywords (text), request_by (uuid), tag (text), load_time (int), is_fulfilled (bool default false)
  - We collect keywords from user (no Name field anymore).
  - request_by = current user id
  - is_fulfilled = false (implicit; do not send if default)
  - Show list of user's past requests (latest first) with basic status display & refresh.
  - Provide realtime subscription (optional future step) guarded behind presence of channel support.
*/

export default function Request() {
  const [userId, setUserId] = useState(null);
  const [keywords, setKeywords] = useState(''); // space separated only
  const [searchUrl, setSearchUrl] = useState(''); // LinkedIn search URL (mutually exclusive with keywords)
  // Name field removed per schema change
  const [tag, setTag] = useState('');
  const [loadTime, setLoadTime] = useState(3);
  // Updated: scrape_likes binary toggle (true=likes pipeline, false=posts pipeline)
  // Default ON (likes) per requirement.
  const [scrapeLikes, setScrapeLikes] = useState(true);
  // Bulk upload state
  const [bulkTag, setBulkTag] = useState('');
  const [bulkFile, setBulkFile] = useState(null);
  const [bulkMsg, setBulkMsg] = useState(null);
  const [bulkErr, setBulkErr] = useState(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ total: 0, success: 0, failed: 0 });
  const [bulkLastError, setBulkLastError] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [formMsg, setFormMsg] = useState(null);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [history, setHistory] = useState([]);
  const [historyError, setHistoryError] = useState(null);
  const [realtimeEnabled, setRealtimeEnabled] = useState(false);

  // Acquire current user id
  useEffect(() => {
    let mounted = true;
    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error) return;
      setUserId(data?.user?.id || null);
    });
    return () => { mounted = false; };
  }, []);

  const loadHistory = useCallback(async () => {
    if (!userId) return;
    setLoadingHistory(true);
    setHistoryError(null);
    try {
      const { data, error } = await supabase
    .from('requests')
    .select('request_id, created_at, keywords, search_url, tag, load_time, is_fulfilled, scrape_likes')
        .eq('request_by', userId)
        .order('created_at', { ascending: false })
        .limit(200);
      if (error) throw error;
      setHistory(Array.isArray(data) ? data : []);
    } catch (e) {
      setHistoryError(e.message || 'Failed to load history');
    } finally {
      setLoadingHistory(false);
    }
  }, [userId]);

  useEffect(() => { loadHistory(); }, [loadHistory]);

  // Optional: realtime updates for this user's requests
  useEffect(() => {
    if (!userId) return;
    // Attempt to create a channel only if realtime is available in this client build
    try {
      const channel = supabase.channel(`requests-user-${userId}`);
      channel
        .on('postgres_changes', {
          event: '*',
          schema: 'public',
          table: 'requests',
          filter: `request_by=eq.${userId}`
        }, (payload) => {
          // Simple strategy: reload history (small volume expected)
            loadHistory();
        })
        .subscribe(status => {
          if (status === 'SUBSCRIBED') setRealtimeEnabled(true);
        });
      return () => { supabase.removeChannel(channel); };
    } catch {
      // ignore if realtime not supported
    }
  }, [userId, loadHistory]);

  const resetMessages = () => { setFormError(null); setFormMsg(null); };

  const handleSubmit = async (e) => {
    e.preventDefault();
    resetMessages();
    if (!userId) { setFormError('You must be logged in.'); return; }
    const kw = keywords.trim();
    const su = searchUrl.trim();
    if ((kw && su) || (!kw && !su)) { setFormError('Fill either Keywords or LinkedIn Search URL (one only).'); return; }
    if (kw) {
      if (/[,\n]/.test(kw)) { setFormError('Remove commas / line breaks. Use single spaces.'); return; }
      if (/\s{2,}/.test(kw)) { setFormError('Collapse multiple spaces between keywords.'); return; }
    }
    if (!tag.trim()) { setFormError('Tag is required.'); return; }
    const num = Number(loadTime);
    if (!Number.isFinite(num) || num < 1) { setFormError('Duration must be a number >= 1.'); return; }

    setSubmitting(true);
    try {
      const row = {
        keywords: kw || null,
        search_url: su || null,
        request_by: userId,
        tag: tag.trim(),
        load_time: num,
        // is_fulfilled left as default (false)
        scrape_likes: scrapeLikes
      };
      const { data, error } = await supabase.from('requests').insert([row]).select().maybeSingle();
      if (error) throw error;
      setFormMsg('Request submitted.');
  setKeywords('');
  setSearchUrl('');
      // Preserve scrapeLikes selection; do not reset.
      // Keep name sticky so user doesn't retype each time
      // Refresh history (or rely on realtime)
      if (!realtimeEnabled) loadHistory();
    } catch (e) {
      setFormError(e.message || 'Failed to submit request');
    } finally {
      setSubmitting(false);
      setTimeout(() => { setFormMsg(null); setFormError(null); }, 4000);
    }
  };

  // -------------------- Bulk Upload Helpers ---------------------------
  function downloadSampleCsv(){
    const headers = ['linkedin_url','bio'];
    const rows = [
      ['https://www.linkedin.com/in/ACoAAB52FMgB3mqH5YbMWQTwnJnYxyBzqr72gdE','Founder at ExampleCorp; building AI tools.'],
      ['ACoAAB52FMgB3mqH5YbMWQTwnJnYxyBzqr72gdE?trk=example','VP Growth at B2B SaaS; RevOps background.']
    ];
    const csv = [headers.join(','), ...rows.map(r=> r.map(v=>`"${String(v).replaceAll('"','""')}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = 'sample_all_leads.csv'; a.click(); URL.revokeObjectURL(url);
  }

  function parseCsv(text){
    // Simple CSV parser supporting quoted fields and commas within quotes
    const rows = [];
    let i=0, field='', row=[], inQuotes=false;
    function endField(){ row.push(field); field=''; }
    function endRow(){ rows.push(row); row=[]; }
    while(i < text.length){
      const ch = text[i];
      if(inQuotes){
        if(ch==='"'){
          if(text[i+1]==='"'){ field+='"'; i+=2; continue; }
          inQuotes=false; i++; continue;
        } else { field+=ch; i++; continue; }
      } else {
        if(ch==='"'){ inQuotes=true; i++; continue; }
        if(ch===','){ endField(); i++; continue; }
        if(ch==='\n'){ endField(); endRow(); i++; continue; }
        if(ch==='\r'){ // handle CRLF
          if(text[i+1]==='\n'){ i++; }
          endField(); endRow(); i++; continue;
        }
        field+=ch; i++;
      }
    }
    // finalize
    endField(); if(row.length>1 || row[0]!=='' ) endRow();
    // Map to objects using header row
    if(!rows.length) return [];
    const header = rows[0].map(h=> String(h||'').trim());
    const out = [];
    for(let r=1; r<rows.length; r++){
      const rec = {}; const line = rows[r];
      header.forEach((h,idx)=>{ rec[h] = line[idx] !== undefined ? line[idx] : ''; });
      out.push(rec);
    }
    return out;
  }

  function extractLeadId(linkedin){
    const raw = String(linkedin||'').trim();
    if(!raw) return '';
    // If it's a bare ID possibly with query
    const looksLikeId = /^[A-Za-z0-9-_]+(\?.*)?$/.test(raw) && !raw.includes('/') && !raw.startsWith('http');
    if(looksLikeId){ return raw.split('?')[0]; }
    // Try URL parsing
    try{
      const u = new URL(raw);
      const path = u.pathname || '';
      const idx = path.indexOf('/in/');
      if(idx >= 0){
        const rest = path.slice(idx + 4); // after '/in/'
        const seg = rest.split(/[/?#]/)[0];
        return seg || '';
      }
      // fallback: last segment without query
      const segments = path.split('/').filter(Boolean);
      const last = segments[segments.length-1] || '';
      return last.split('?')[0];
    }catch{ // Not a valid URL, attempt to extract between '/in/' and '?'
      const m = raw.match(/\/in\/([^/?#]+)(?:[/?#]|\?|$)/);
      if(m) return m[1];
      return raw.split('?')[0];
    }
  }

  async function handleBulkUpload(){
    setBulkMsg(null); setBulkErr(null); setBulkLastError(null);
    if(!userId){ setBulkErr('You must be logged in.'); return; }
    if(!bulkTag.trim()){ setBulkErr('Tag is required for bulk upload.'); return; }
    if(!bulkFile){ setBulkErr('Please choose a CSV file.'); return; }
    const file = bulkFile;
    if(!/\.csv$/i.test(file.name)){
      setBulkErr('Only CSV is supported at the moment. Please upload a .csv file.');
      return;
    }
    setBulkRunning(true); setBulkProgress({ total: 0, success: 0, failed: 0 });
    try{
      const text = await file.text();
      const records = parseCsv(text);
      if(!records.length){ setBulkErr('CSV appears empty or invalid. Ensure a header row exists.'); return; }
      // Normalize headers (case-insensitive)
      const hasLinkedin = Object.keys(records[0]).some(k=>k.toLowerCase()==='linkedin_url');
      const hasBio = Object.keys(records[0]).some(k=>k.toLowerCase()==='bio');
      if(!hasLinkedin || !hasBio){ setBulkErr('CSV must include headers: linkedin_url, bio'); return; }
      const norm = (obj)=>{
        const out={}; Object.keys(obj).forEach(k=> out[k.toLowerCase()] = obj[k]); return out;
      };
      setBulkProgress(p=>({ ...p, total: records.length }));
      let ok=0, bad=0;
      for(const rec of records){
        const r = norm(rec);
        const linkedin_url = String(r['linkedin_url']||'').trim();
        const bio = String(r['bio']||'').trim();
        if(!linkedin_url){ bad++; setBulkLastError('Missing linkedin_url in a row'); setBulkProgress(pr=>({ ...pr, failed: bad })); continue; }
        const lead_id = extractLeadId(linkedin_url);
        const row = {
          lead_id,
          linkedin_url,
          bio,
          tag: bulkTag.trim(),
          user_id: userId
        };
        try{
          const { error } = await supabase.from('all_leads').insert([row]);
          if(error){ bad++; setBulkLastError(error.message); setBulkProgress(pr=>({ ...pr, failed: bad })); }
          else { ok++; setBulkProgress(pr=>({ ...pr, success: ok })); }
        }catch(e){ bad++; setBulkLastError(e.message||'Insert failed'); setBulkProgress(pr=>({ ...pr, failed: bad })); }
      }
      setBulkMsg(`Upload complete. Inserted: ${ok}, Failed: ${bad}.`);
    }catch(e){ setBulkErr(e.message||'Failed to process file'); }
    finally{ setBulkRunning(false); }
  }

  return (
    <div className="page1">
      <div className="hero">
        <div className="card" style={{ maxWidth: 780 }}>
          <h2>Request Dashboard</h2>
          <p className="muted" style={{ marginTop: 4 }}>Create new processing / scraping requests and view your history.</p>
          <div className="small" style={{marginTop:8,background:'#f1f5f9',padding:'8px 10px',border:'1px solid var(--border-color)',borderRadius:6}}>
            <div><strong>Fill one:</strong> either <strong>Keywords</strong> or <strong>LinkedIn Search URL</strong> (not both).</div>
            <div style={{marginTop:4}}><strong>Keyword format:</strong> If multiple keywords, separate them with a single space. Do NOT use commas or line breaks.</div>
          </div>
          {/* Accounts needed note moved to bottom */}

          {/* Form Section */}
          <form onSubmit={handleSubmit} className="request-form" style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>Keywords<span style={{ color: 'crimson' }}> *</span></span>
              <input
                type="text"
                value={keywords}
                disabled={submitting || Boolean(searchUrl.trim())}
                onChange={(e) => setKeywords(e.target.value)}
                placeholder="salesforce ai architect"
                inputMode="text"
                pattern="^[^,\n]+$"
                title="Space-separated keywords only. No commas or line breaks."
              />
            </label>
            <div className="small muted" style={{marginTop:-8}}>Or</div>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>LinkedIn Post Search URL<span style={{ color: 'crimson' }}> *</span></span>
              <input
                type="url"
                value={searchUrl}
                disabled={submitting || Boolean(keywords.trim())}
                onChange={(e)=> setSearchUrl(e.target.value)}
                placeholder="https://www.linkedin.com/search/results/content/?keywords=..."
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>Tag<span style={{ color: 'crimson' }}> *</span></span>
              <input
                type="text"
                value={tag}
                disabled={submitting}
                onChange={(e)=> setTag(e.target.value)}
                placeholder="e.g. Dreamforce-Campaign, Gitex-Campaign, etc."
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span className="small" style={{ fontWeight: 600 }}>Duration (sec)<span style={{ color: 'crimson' }}> *</span></span>
              <input
                type="number"
                min={1}
                step={1}
                value={loadTime}
                disabled={submitting}
                onChange={(e)=> setLoadTime(e.target.value)}
                placeholder="3"
              />
              <span className="small muted">Try to keep duration between 3–10 sec.</span>
            </label>
            {/* scrape_likes pipeline selection via two checkboxes (mutually exclusive) */}
            <div style={{display:'flex',flexDirection:'column',gap:6}}>
              <span className="small" style={{fontWeight:600}}>Pipeline Selection</span>
              <label className="small" style={{display:'flex',alignItems:'center',gap:6}}>
                <input
                  type="checkbox"
                  checked={scrapeLikes === true}
                  onChange={()=> setScrapeLikes(true)}
                  disabled={submitting}
                />
                Include Likes (likes pipeline)
              </label>
              <label className="small" style={{display:'flex',alignItems:'center',gap:6}}>
                <input
                  type="checkbox"
                  checked={scrapeLikes === false}
                  onChange={()=> setScrapeLikes(false)}
                  disabled={submitting}
                />
                Exclude Likes (posts pipeline)
              </label>
              <div className="small muted">{scrapeLikes? 'Will run likes data pipeline.' : 'Will run posts data pipeline.'}</div>
            </div>
            {/* Name field removed */}
            <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
              <button type="submit" className="btn btn-primary" disabled={submitting || !userId}>{submitting ? 'Submitting...' : 'Send Request'}</button>
              <button type="button" className="btn btn-ghost" disabled={submitting} onClick={() => { setKeywords(''); setSearchUrl(''); }}>{'Clear'}</button>
              {userId && <span className="small muted">User ID: {userId.slice(0, 8)}…</span>}
              {realtimeEnabled && <span className="badge" style={{ background: '#065f46', color: 'white', fontSize: 10 }}>Realtime</span>}
            </div>
            {formError && <div className="form-error" style={{ color: 'crimson', fontSize: 13 }}>{formError}</div>}
            {formMsg && <div className="form-success" style={{ color: '#065f46', fontSize: 13 }}>{formMsg}</div>}
          </form>

          {/* History Section */}
          <div style={{ marginTop: 32 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <h3 style={{ margin: 0 }}>Your Requests</h3>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn btn-ghost" disabled={loadingHistory} onClick={() => loadHistory()}>{loadingHistory ? 'Refreshing...' : 'Refresh'}</button>
              </div>
            </div>
            {historyError && <div style={{ color: 'crimson', marginTop: 8 }}>{historyError}</div>}
            <div className="small muted" style={{ marginTop: 4 }}>Showing latest {history.length} requests (max 200).</div>
            <div style={{ marginTop: 12, overflowX: 'auto' }}>
              <table className="data-table small">
                <thead>
                  <tr>
                    <th style={{ whiteSpace: 'nowrap' }}>Created</th>
                    <th>Keywords</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Search URL</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Tag</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Duration</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Pipeline</th>
                    <th style={{ whiteSpace: 'nowrap' }}>Fulfilled</th>
                    <th>ID</th>
                  </tr>
                </thead>
                <tbody>
                  {history.map(r => (
                    <tr key={r.request_id}>
                      <td title={r.created_at}>{r.created_at?.slice(0,19).replace('T',' ')}</td>
                      <td className="truncate" title={r.keywords}>{r.keywords?.slice(0,120) || '—'}</td>
                      <td className="truncate" title={r.search_url}>{r.search_url?.slice(0,120) || '—'}</td>
                      <td className="truncate" title={r.tag}>{r.tag || '—'}</td>
                      <td style={{ textAlign:'center' }}>{r.load_time ?? '—'}</td>
                      <td style={{ textAlign:'center' }} title={typeof r.scrape_likes === 'boolean' ? (r.scrape_likes? 'Scrape Likes pipeline':'Scrape Posts pipeline') : 'Unknown'}>
                        {typeof r.scrape_likes === 'boolean' ? (r.scrape_likes ? 'Likes' : 'Posts') : '—'}
                      </td>
                      <td style={{ textAlign: 'center' }}>{r.is_fulfilled ? 'Yes' : 'No'}</td>
                      <td className="truncate" title={r.request_id}>{r.request_id?.slice(0,8)}…</td>
                    </tr>
                  ))}
                  {!history.length && !loadingHistory && <tr><td colSpan={8} className="empty">No requests yet</td></tr>}
                  {loadingHistory && <tr><td colSpan={8}>Loading…</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
          {/* Accounts Needed note removed */}
          {/* Bulk Upload Section */}
          <div style={{ marginTop: 32 }}>
            <div className="card" style={{ padding: 16 }}>
              <h3 style={{ marginTop: 0 }}>Bulk Upload to all_leads</h3>
              <p className="small muted" style={{ marginTop: 4 }}>Upload a CSV with columns: linkedin_url, bio. We'll compute lead_id, apply the Tag to all rows, and insert to all_leads under your user.</p>
              <div className="flex-row wrap" style={{ gap: 12, alignItems: 'flex-end', marginTop: 10 }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="small" style={{ fontWeight: 600 }}>Tag<span style={{ color: 'crimson' }}> *</span></span>
                  <input type="text" value={bulkTag} onChange={e=>setBulkTag(e.target.value)} placeholder="e.g. SDR, Marketing" disabled={bulkRunning} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <span className="small" style={{ fontWeight: 600 }}>CSV File<span style={{ color: 'crimson' }}> *</span></span>
                  <input type="file" accept=".csv" onChange={e=>setBulkFile(e.target.files?.[0] || null)} disabled={bulkRunning} />
                </label>
                <button type="button" className="btn primary" onClick={handleBulkUpload} disabled={bulkRunning || !userId}>{bulkRunning? 'Uploading…' : 'Upload'}</button>
                <button type="button" className="btn outline" onClick={downloadSampleCsv} disabled={bulkRunning}>Download sample CSV</button>
              </div>
              <div className="small" style={{ marginTop: 8 }}>
                Total: {bulkProgress.total} | Success: {bulkProgress.success} | Failed: {bulkProgress.failed}
              </div>
              {bulkMsg && <div className="small" style={{ color: '#065f46', marginTop: 6 }}>{bulkMsg}</div>}
              {bulkErr && <div className="small" style={{ color: 'crimson', marginTop: 6 }}>{bulkErr}</div>}
              {bulkLastError && <div className="small muted" style={{ marginTop: 6 }}>Last error: {bulkLastError}</div>}
              <div className="small muted" style={{ marginTop: 6 }}>
                Note: If a row already exists (duplicate lead_id), it will fail but other rows will continue.
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
