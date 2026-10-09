(function(){
"use strict";
const $=id=>document.getElementById(id);
function esc(v){const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML;}
function roleIsSuperAdmin(){try{const u=JSON.parse(localStorage.getItem("myworkshop_user")||"null");const c=String(u?.role?.code||u?.role?.role_code||u?.role_code||"").trim().toUpperCase();const n=String(u?.role?.name||u?.role?.role_name||u?.role_name||"").trim().toUpperCase();return c==="SUPER_ADMIN"||n==="SUPER ADMIN";}catch(_){return false;}}
function normRole(v){return String(v||"").trim().toUpperCase().replace(/[_-]+/g," ").replace(/\s+/g," ");}
function fmtDate(v){if(!v)return "-";try{return new Date(v).toLocaleString("id-ID",{day:"2-digit",month:"2-digit",year:"numeric",hour:"2-digit",minute:"2-digit"});}catch(_){return String(v);}}
function setText(id,v){const e=$(id);if(e)e.textContent=Number.isFinite(Number(v))?Number(v).toLocaleString("id-ID"):String(v??"-");}
let workshops=[];
function populateFilter(){const s=$("saWorkshopFilter");if(!s)return;const current=s.value;s.innerHTML='<option value="0">Semua Bengkel</option>'+workshops.map(w=>`<option value="${esc(w.id)}">${esc(w.name||"-")} (${esc(w.workshop_code||"-")})</option>`).join("");if([...s.options].some(o=>o.value===current))s.value=current;}
function renderTotals(t){setText("saTotalWorkshops",t.workshops);setText("saActiveWorkshops",t.active_workshops);setText("saTotalUsers",t.users);setText("saActiveUsers",t.active_users);setText("saEstimates",t.estimates);setText("saWoActive",t.wo_active);setText("saWoCheckout",t.wo_checkout);setText("saTagihan",t.tagihan);setText("saPermintaan",t.permintaan_sparepart);setText("saPenerimaan",t.penerimaan_sparepart);setText("saStockIn",t.sparepart_stock_in);setText("saStockOut",t.sparepart_stock_out);}
function renderWorkshops(rows){const c=$("saWorkshops");if(!rows.length){c.innerHTML='<div class="sa-empty">Belum ada bengkel pada filter ini.</div>';return;}c.innerHTML=rows.map(w=>`<div class="sa-workshop"><div class="sa-workshop-head"><div><div class="sa-code">${esc(w.workshop_code||"-")}</div><div class="sa-name">${esc(w.name||"-")}</div></div><span class="sa-status${Number(w.is_active)?"":" off"}">${Number(w.is_active)?"AKTIF":"NONAKTIF"}</span></div><div class="sa-meta"><div><span>User</span><strong>${Number(w.users).toLocaleString("id-ID")}</strong></div><div><span>User Aktif</span><strong>${Number(w.active_users).toLocaleString("id-ID")}</strong></div><div><span>Manager Master</span><strong>${Number(w.managers).toLocaleString("id-ID")}</strong></div><div><span>Estimasi</span><strong>${Number(w.estimates).toLocaleString("id-ID")}</strong></div><div><span>WO Aktif</span><strong>${Number(w.wo_active).toLocaleString("id-ID")}</strong></div><div><span>WO CHECK OUT</span><strong>${Number(w.wo_checkout).toLocaleString("id-ID")}</strong></div></div><div class="sa-workshop-foot"><span>Tagihan: <strong>${Number(w.tagihan).toLocaleString("id-ID")}</strong></span><span>Permintaan Sparepart: <strong>${Number(w.permintaan_sparepart||0).toLocaleString("id-ID")}</strong></span><span>Penerimaan: <strong>${Number(w.penerimaan_sparepart||0).toLocaleString("id-ID")}</strong></span></div></div>`).join("");}
function renderAlerts(rows){const c=$("saAlerts");if(!rows.length){c.innerHTML='<div class="sa-empty">Tidak ada indikator yang perlu diperiksa.</div>';return;}c.innerHTML=rows.slice(0,12).map(a=>`<div class="sa-alert"><span class="sa-alert-badge ${esc(a.severity||"info")}">${esc(String(a.severity||"INFO").toUpperCase())}</span><div><div class="sa-alert-title">${esc(a.title||"-" )}</div><div class="sa-alert-detail">${esc(a.detail||"")}${a.workshop_name?" • "+esc(a.workshop_name):""}</div></div><div class="sa-alert-count">${Number(a.count||0).toLocaleString("id-ID")}</div></div>`).join("");}
function renderActivity(rows){const c=$("saActivity");if(!rows.length){c.innerHTML='<div class="sa-empty">Belum ada aktivitas yang tercatat.</div>';return;}c.innerHTML=rows.slice(0,25).map(r=>`<div class="sa-activity-row"><div class="sa-activity-time">${esc(fmtDate(r.created_at))}</div><div class="sa-activity-main"><strong>${esc(r.action||r.module||"Aktivitas")}</strong><span>${esc(r.detail||r.module||"-")} • ${esc(r.user_full_name||r.username||"Sistem")}</span></div><div class="sa-activity-workshop">${esc(r.workshop_name||"Global / Sistem")}</div></div>`).join("");}
async function runGlobalSearch(){
    const input=$("saGlobalSearch"), box=$("saSearchResults"), btn=$("saGlobalSearchBtn");
    const q=String(input?.value||"").trim();
    if(!box) return;
    if(q.length<2){box.innerHTML='<div class="sa-search-empty">Masukkan minimal 2 karakter.</div>';return;}
    if(btn){btn.disabled=true;btn.textContent="Mencari...";}
    box.innerHTML='<div class="sa-search-empty">Mencari data lintas bengkel...</div>';
    try{
        const r=await fetch(`/api/super-admin/search?q=${encodeURIComponent(q)}&_=${Date.now()}`,{cache:"no-store",headers:{Accept:"application/json"}});
        const text=await r.text();
        let data={};
        try { data=JSON.parse(text); }
        catch (_) {
            console.error("RESPON PENCARIAN SUPER ADMIN BUKAN JSON:", text);
            throw new Error(`Server mengembalikan halaman HTML (HTTP ${r.status}). Pastikan server.js versi terbaru sedang berjalan.`);
        }
        if(!r.ok||!data?.success) throw new Error(data?.message||"Pencarian gagal.");
        const rows=Array.isArray(data.data)?data.data:[];
        if(!rows.length){box.innerHTML='<div class="sa-search-empty">Tidak ditemukan data yang sesuai.</div>';return;}
        box.innerHTML=rows.slice(0,100).map(x=>{
            const fields=Object.entries(x.fields||{}).filter(([,v])=>v!==null&&v!==undefined&&String(v)!=="").slice(0,8);
            return `<div class="sa-result"><div class="sa-result-top"><div class="sa-result-module">${esc(x.module||"Data")}</div><div class="sa-result-workshop">${esc(x.workshop_name||"Global / Sistem")}</div></div><div class="sa-result-id">${esc(x.record_id||"-")}</div><div class="sa-result-fields">${fields.map(([k,v])=>`<span class="sa-result-field"><strong>${esc(k)}:</strong> ${esc(v)}</span>`).join("")}</div></div>`;
        }).join("");
    }catch(e){box.innerHTML=`<div class="sa-search-empty">${esc(e.message||"Pencarian gagal.")}</div>`;}
    finally{if(btn){btn.disabled=false;btn.textContent="Cari";}}
}
async function loadDashboard(){if(!roleIsSuperAdmin()){window.location.replace("/dashboard.html");return;}const btn=$("saRefresh");if(btn){btn.disabled=true;btn.textContent="Memuat...";}try{const wid=Number($("saWorkshopFilter")?.value||0);const r=await fetch(`/api/super-admin/monitoring?workshop_id=${wid}&_=${Date.now()}`,{cache:"no-store"});const j=await r.json();if(!r.ok||!j?.success)throw new Error(j?.message||"Gagal mengambil data monitoring.");renderTotals(j.totals||{});renderWorkshops(Array.isArray(j.workshops)?j.workshops:[]);renderAlerts(Array.isArray(j.alerts)?j.alerts:[]);renderActivity(Array.isArray(j.recent_activity)?j.recent_activity:[]);$("saUpdated").textContent="Diperbarui: "+fmtDate(j.generated_at);if(Array.isArray(j.workshops)&&!wid){workshops=j.workshops;populateFilter();}else if(!workshops.length){const wr=await fetch("/api/super-admin/workshops?_="+Date.now(),{cache:"no-store"});const wj=await wr.json();if(wr.ok&&wj?.success&&Array.isArray(wj.data)){workshops=wj.data;populateFilter();}}}catch(e){$("saUpdated").textContent="Gagal memuat data";$("saWorkshops").innerHTML=`<div class="sa-empty">${esc(e.message||"Gagal mengambil data.")}</div>`;$("saAlerts").innerHTML='<div class="sa-empty">Data tidak tersedia.</div>';$("saActivity").innerHTML='<div class="sa-empty">Data tidak tersedia.</div>';}finally{if(btn){btn.disabled=false;btn.textContent="↻ Perbarui Data";}}}
function init(){if(!roleIsSuperAdmin()){window.location.replace("/dashboard.html");return;}const u=JSON.parse(localStorage.getItem("myworkshop_user")||"null");if(u?.full_name)$("saWelcomeName").textContent=u.full_name;const s=$("saWorkshopFilter");if(s)s.addEventListener("change",loadDashboard);const b=$("saRefresh");if(b)b.addEventListener("click",loadDashboard);const gs=$("saGlobalSearch"),gb=$("saGlobalSearchBtn");if(gb)gb.addEventListener("click",runGlobalSearch);if(gs)gs.addEventListener("keydown",e=>{if(e.key==="Enter")runGlobalSearch();});loadDashboard();}
if(document.readyState==="loading")document.addEventListener("DOMContentLoaded",init,{once:true});else init();
})();
