(function(){
"use strict";
const $=id=>document.getElementById(id);
let currentType="";let currentData=[];let currentTitle="Hasil Laporan";let selectedReportType="";
let purchaseWOData=[];let purchasePOData=[];
const defs={
 "mobil-masuk":{title:"LAPORAN MOBIL MASUK",from:"masukFrom",to:"masukTo",user:"masukUser",url:"/api/laporan/mobil-masuk",head:["No","No. WO","Asuransi","Customer","No. Polisi","Merek / Type","Warna","WO Dibuat","Check In","User WO"]},
 "mobil-keluar":{title:"LAPORAN MOBIL KELUAR",from:"keluarFrom",to:"keluarTo",user:"keluarUser",url:"/api/laporan/mobil-keluar",head:["No","No. WO","Asuransi","Customer","No. Polisi","Merek / Type","Warna","Check In","Check Out","Lama di Bengkel","Target Selesai","Keterangan Tambahan","Keterangan Check Out","User WO"]},
 "own-risk":{title:"LAPORAN TAGIHAN OWN RISK (OR)",from:"orFrom",to:"orTo",url:"/api/laporan/own-risk",head:["No","No. WO","Asuransi","Customer","No. Polisi","Total Nilai OR","Nilai Free","Nilai Harus Dibayar","Nilai Dibayar","Total Dibayar","Hutang / Sisa","Pembayaran Ke","Metode","Tanggal Bayar","Keterangan","Status","User"]},
 "own-risk-outstanding":{title:"LAPORAN TAGIHAN OWN RISK (OR) BELUM LUNAS",noPeriod:true,url:"/api/laporan/own-risk-outstanding",head:["No","No. WO","Asuransi","Customer","No. Polisi","Total Nilai OR","Nilai Free","Nilai Harus Dibayar","Total Dibayar","Hutang / Sisa","Status","User"]},
 "kuitansi":{title:"LAPORAN KUITANSI TAGIHAN",from:"kuitansiFrom",to:"kuitansiTo",url:"/api/laporan/kuitansi",head:["No","No. Kuitansi","No. WO","Asuransi","No. Klaim","Customer","No. Polisi","Grand Total","Tanggal Kuitansi","User Pembuat"]},
 "penghapusan":{title:"LAPORAN PENGHAPUSAN",from:"hapusFrom",to:"hapusTo",url:"/api/laporan/penghapusan",head:["No","No. Estimasi / No. WO","Tanggal","Customer","Asuransi","Alasan"]},
 "outstanding-estimasi":{title:"LAPORAN OUTSTANDING ESTIMASI",from:"outEstimasiFrom",to:"outEstimasiTo",url:"/api/laporan/outstanding-estimasi",head:["No","No. Estimasi","Tanggal Estimasi","Customer","No. Polisi","Merek / Type","Asuransi","Total yang Ditagihkan"]},
 "outstanding":{title:"LAPORAN OUTSTANDING WO",from:"outFrom",to:"outTo",user:"outUser",url:"/api/laporan/outstanding-wo",head:["No","No. WO","Asuransi","Customer","No. Polisi","Merek / Type","Warna","Tanggal Selesai","Keterangan Check Out","User WO"]},
 "outstanding-payment":{title:"LAPORAN OUTSTANDING PEMBAYARAN",from:"outPayFrom",to:"outPayTo",url:"/api/laporan/outstanding-pembayaran",head:["No","No. WO","Asuransi","No. Klaim","Customer","No. Polisi","Grand Total","Tanggal Kuitansi","User WO"]},
 "vendor-produksi":{title:"LAPORAN VENDOR PRODUKSI",from:"vendorFrom",to:"vendorTo",worker:"vendorWorker",url:"/api/laporan/vendor-produksi",head:["No","Tanggal Input","No. WO","Asuransi","Customer","No. Polisi","Nama Pekerja","Jenis Pekerjaan","Harga Pekerja"]},
 "pembelian-barang":{title:"LAPORAN PEMBELIAN BARANG",from:"beliFrom",to:"beliTo",vendor:"beliVendor",head:["No","No. PO","No. WO","Asuransi","Customer","No. Polisi","Nama Sparepart","SKU / No. Part","Qty","Vendor","Harga Beli","Harga Jual","Margin"]},
 "komisi-agent":{title:"LAPORAN KOMISI AGENT",from:"komisiFrom",to:"komisiTo",agent:"komisiAgent",url:"/api/laporan/komisi-agent",head:["No","No. WO","Customer","Asuransi","Nilai Kuitansi Tagihan","Nama Agent","Nilai Komisi"]},
 "omset":{title:"LAPORAN OMSET",from:"omsetFrom",to:"omsetTo",url:"/api/laporan/omset",head:["No","Tanggal Kuitansi","No. WO","Asuransi","Customer","No. Polisi","Nilai Kuitansi Tagihan","Netto Harga Beli Sparepart","Ketok","Dempul","Cat","Poles","Total Vendor Produksi","Pemakaian Bahan","Biaya Survey","Biaya/Komisi Agent","Income (Pendapatan)","Info PPN","Info PPh"]}
};
function userId(){try{const u=JSON.parse(localStorage.getItem("myworkshop_user")||"null");return Number(u?.id||u?.user_id||0)||null}catch(_){return null}}
function esc(v){const d=document.createElement("div");d.textContent=String(v??"");return d.innerHTML}
function money(v){return "Rp "+Number(v||0).toLocaleString("id-ID")}
function dt(v){if(!v)return "-";const s=String(v);const d=new Date(s.includes("T")?s:s.replace(" ","T")+"Z");return Number.isNaN(d.getTime())?s:d.toLocaleString("id-ID",{dateStyle:"short",timeStyle:"short"})}
function dateOnly(v){if(!v)return "-";return String(v).slice(0,10).split("-").reverse().join("-")}
function today(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`}
async function api(url,options={}){const r=await fetch(url,{...options,headers:{"Content-Type":"application/json",...(options.headers||{})}});let j={};try{j=await r.json()}catch(_){}if(!r.ok||j.success===false)throw new Error(j.message||"Gagal mengambil laporan.");return j}
async function loadUsers(){try{const r=await api("/api/laporan/users");const users=Array.isArray(r.data)?r.data:[];["masukUser","keluarUser","outUser"].forEach(id=>{const s=$(id);if(!s)return;const old=s.value;s.innerHTML='<option value="">ALL USER</option>'+users.map(u=>`<option value="${esc(u.id)}">${esc(u.full_name||u.username||( "User "+u.id))}</option>`).join("");s.value=old;})}catch(e){console.warn("Gagal memuat user laporan",e)}}
function defaults(){const t=today();document.querySelectorAll('input[type="date"]').forEach(i=>{if(!i.value)i.value=t})}
function validate(def){if(def.noPeriod)return {from:"",to:"",user:"",worker:"",vendor:"",agent:""};const f=$(def.from).value,t=$(def.to).value;if(!f||!t){myWorkshopAlert("Rentang tanggal wajib diisi.");return null}if(f>t){myWorkshopAlert("Dari Tanggal tidak boleh lebih besar dari Sampai Tanggal.");return null}return {from:f,to:t,user:def.user?$(def.user).value:"",worker:def.worker?$(def.worker).value.trim():"",vendor:def.vendor?$(def.vendor).value.trim():"",agent:def.agent?$(def.agent).value.trim():""}}
function cells(type,row){switch(type){case"mobil-masuk":return [row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,`${row.brand||""} ${row.model||""}`.trim(),row.color,row.wo_created_at?dt(row.wo_created_at):"-",row.check_in_at?dt(row.check_in_at):"-",row.user_name];case"mobil-keluar":return [row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,`${row.brand||""} ${row.model||""}`.trim(),row.color,row.check_in_at?dt(row.check_in_at):"-",dt(row.check_out_at),row.lama_di_bengkel_display||"-",row.target_date?dateOnly(row.target_date):"-",row.keterangan_target||"-",row.checkout_note,row.user_name];case"own-risk":return [row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,money(row.own_risk),money(row.free_amount),money(row.amount_due),money(row.amount),money(row.total_paid),money(row.amount_remaining),`Ke-${row.payment_sequence||"-"}`,row.payment_method,dt(row.paid_at),row.payment_description_display||row.payment_description,row.payment_status,row.user_name];case"own-risk-outstanding":return [row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,money(row.own_risk),money(row.free_amount),money(row.amount_due),money(row.amount_paid),money(row.amount_remaining),"BELUM LUNAS",row.user_name];case"kuitansi":return [row.kuitansi_number||"-",row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.claim_number||"-",row.customer_name,row.plate_number,money(row.grand_total),dt(row.kuitansi_created_at),row.user_name];case"outstanding-estimasi":return [row.estimate_number||"-",row.estimate_date?dateOnly(row.estimate_date):"-",row.customer_name||"-",row.plate_number||"-",`${row.brand||""} ${row.model||""}`.trim()||"-",(row.insurer_alias||row.insurerAlias||"-"),money(row.total_billed)];case"outstanding":return [row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,`${row.brand||""} ${row.model||""}`.trim(),row.color,dt(row.first_checkout_at),row.checkout_note,row.user_name];case"outstanding-payment":return [row.kuitansi_number||"-",row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.claim_number||"-",row.customer_name,row.plate_number,money(row.grand_total),dt(row.kuitansi_created_at),row.user_name];case"vendor-produksi":return [dt(row.input_at),row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,row.worker_name,row.worker_type,money(row.worker_price)];case"pembelian-barang":return [row.po_number||"-",row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,row.part_name,row.part_number||"-",row.quantity,row.vendor||"-",money(row.buy_price),money(row.sell_price),money(row.margin)];case"omset":return [dateOnly(row.kuitansi_created_at),row.wo_number,(row.insurer_alias||row.insurerAlias||"-"),row.customer_name,row.plate_number,money(row.nilai_kuitansi),money(row.netto_harga_beli_sparepart),money(row.ketok),money(row.dempul),money(row.cat),money(row.poles),money(row.total_vendor_produksi),money(row.pemakaian_bahan),money(row.biaya_survey),money(row.biaya_agent),money(row.ppn_amount),money(row.pph_amount),money(row.income)];case"komisi-agent":return [row.wo_number,row.customer_name,(row.insurer_alias||row.insurerAlias||"-"),money(row.nilai_kuitansi),row.agent_name||"-",money(row.nilai_komisi)];case"penghapusan":return [row.document_number||"-",dateOnly(row.deleted_at),row.customer_name||"-",row.insurer_alias||"-",row.reason||"-"]}}
function enrichMobilKeluarRows(rows){
    return (rows||[]).map(r=>{
        const checkIn=Date.parse(String(r?.check_in_at||""))||0;
        const checkOut=Date.parse(String(r?.check_out_at||""))||0;
        const targetDate=String(r?.target_date||"").slice(0,10);
        let hours=0;
        if(checkIn&&checkOut&&checkOut>=checkIn) hours=(checkOut-checkIn)/3600000;
        const days=Math.floor(hours/24), remHours=Math.floor(hours%24), mins=Math.round((hours-Math.floor(hours))*60);
        r.lama_di_bengkel_hours=hours;
        r.lama_di_bengkel_display=checkIn&&checkOut ? `${days} hari ${remHours} jam ${mins} menit` : "-";
        const checkoutDate=checkOut?new Date(checkOut):null;
        const target=targetDate?new Date(targetDate+"T23:59:59"):null;
        r.keterangan_target=(checkoutDate&&target) ? (checkoutDate.getTime()<=target.getTime()?"Sesuai Target":"Melewati Target") : "Target Tidak Tersedia";
        return r;
    });
}
function enrichOwnRiskRows(rows){const groups=new Map();(rows||[]).forEach(r=>{const key=String(r.wo_id??r.wo_number??"");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r)});groups.forEach(items=>{items.sort((a,b)=>{const ta=Date.parse(String(a.paid_at||""))||0,tb=Date.parse(String(b.paid_at||""))||0;return ta-tb||(Number(a.payment_id)||0)-(Number(b.payment_id)||0)});let cumulative=0;items.forEach((r,i)=>{const amount=Math.max(0,Number(r.amount)||0);cumulative+=amount;r.payment_sequence=i+1;r.total_paid=cumulative;r.amount_remaining=Math.max(0,Number(r.amount_due??((Number(r.own_risk)||0)-(Number(r.free_amount)||0)))-cumulative);r.payment_status=r.amount_remaining<=0?"LUNAS":"BELUM LUNAS"})});return rows}
function valueFor(type,row,key,index){
    const r=row||{};
    if(key==="__no") return Number(index||0)+1;
    const insurer=r.insurer_alias||r.insurerAlias||"-";
    const brandModel=`${r.brand||""} ${r.model||""}`.trim()||"-";
    const map={
        "estimate_number":r.estimate_number||"-", "estimate_date":r.estimate_date?dateOnly(r.estimate_date):"-",
        "customer":r.customer_name||"-", "plate":r.plate_number||"-", "brand_model":brandModel,
        "insurer":insurer, "total_billed":money(r.total_billed), "wo_number":r.wo_number||"-",
        "own_risk":money(r.own_risk), "free_amount":money(r.free_amount), "amount_due":money(r.amount_due),
        "amount_paid":money(r.amount_paid), "amount":money(r.amount), "total_paid":money(r.total_paid),
        "amount_remaining":money(r.amount_remaining), "payment_sequence":`Ke-${r.payment_sequence||"-"}`,
        "payment_method":r.payment_method||"-", "paid_at":dt(r.paid_at),
        "payment_description_display":r.payment_description_display||r.payment_description||"-",
        "payment_status":r.payment_status||"-", "status":r.status||"BELUM LUNAS", "user_name":r.user_name||"-",
        "kuitansi_number":r.kuitansi_number||"-", "claim_number":r.claim_number||"-",
        "grand_total":money(r.grand_total), "kuitansi_created_at":dt(r.kuitansi_created_at),
        "input_at":dt(r.input_at), "worker_name":r.worker_name||"-", "worker_type":r.worker_type||"-",
        "worker_price":money(r.worker_price), "po_number":r.po_number||"-", "part_name":r.part_name||"-",
        "part_number":r.part_number||"-", "quantity":r.quantity??0, "vendor":r.vendor||"-",
        "buy_price":money(r.buy_price), "sell_price":money(r.sell_price), "margin":money(r.margin),
        "nilai_kuitansi":money(r.nilai_kuitansi), "agent_name":r.agent_name||"-", "nilai_komisi":money(r.nilai_komisi),
        "nilai_kuitansi":money(r.nilai_kuitansi), "netto_harga_beli_sparepart":money(r.netto_harga_beli_sparepart),
        "total_vendor_produksi":money(r.total_vendor_produksi), "pemakaian_bahan":money(r.pemakaian_bahan),
        "biaya_survey":money(r.biaya_survey), "biaya_agent":money(r.biaya_agent), "ppn_amount":money(r.ppn_amount),
        "pph_amount":money(r.pph_amount), "income":money(r.income), "ketok":money(r.ketok), "dempul":money(r.dempul),
        "cat":money(r.cat), "poles":money(r.poles), "document_number":r.document_number||"-",
        "deleted_at":dateOnly(r.deleted_at), "reason":r.reason||"-", "color":r.color||"-",
        "check_in_at":r.check_in_at?dt(r.check_in_at):"-", "check_out_at":r.check_out_at?dt(r.check_out_at):"-",
        "lama_di_bengkel_display":r.lama_di_bengkel_display||"-", "target_date":r.target_date?dateOnly(r.target_date):"-",
        "keterangan_target":r.keterangan_target||"-", "checkout_note":r.checkout_note||"-"
    };
    if(Object.prototype.hasOwnProperty.call(map,key)) return map[key];
    if(/^__col\d+$/.test(key)) return cells(type,r)[Number(key.slice(5))] ?? "-";
    return r[key] ?? "-";
}
function reportColumns(type){
    const def=defs[type];
    if(type==="outstanding-estimasi")return [
        {label:"No",key:"__no"},{label:"No. Estimasi",key:"estimate_number"},{label:"Tanggal Estimasi",key:"estimate_date"},{label:"Customer",key:"customer"},
        {label:"No. Polisi",key:"plate"},{label:"Merek / Type",key:"brand_model"},{label:"Asuransi",key:"insurer"},{label:"Total yang Ditagihkan",key:"total_billed"}
    ];
    if(type==="own-risk-outstanding")return [
        {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},
        {label:"Total Nilai OR",key:"own_risk"},{label:"Nilai Free",key:"free_amount"},{label:"Nilai Harus Dibayar",key:"amount_due"},{label:"Total Dibayar",key:"amount_paid"},{label:"Hutang / Sisa",key:"amount_remaining"},{label:"Status",key:"status"},{label:"User",key:"user_name"}
    ];
    if(type==="own-risk")return [
        {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},
        {label:"Total Nilai OR",key:"own_risk"},{label:"Nilai Free",key:"free_amount"},{label:"Nilai Harus Dibayar",key:"amount_due"},{label:"Nilai Dibayar",key:"amount"},{label:"Total Dibayar",key:"total_paid"},{label:"Hutang / Sisa",key:"amount_remaining"},{label:"Pembayaran Ke",key:"payment_sequence"},{label:"Metode",key:"payment_method"},{label:"Tanggal Bayar",key:"paid_at"},{label:"Keterangan",key:"payment_description_display"},{label:"Status",key:"payment_status"},{label:"User",key:"user_name"}
    ];
    if(type==="kuitansi")return [
        {label:"No",key:"__no"},{label:"No. Kuitansi",key:"kuitansi_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"No. Klaim",key:"claim_number"},
        {label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Grand Total",key:"grand_total"},{label:"Tanggal Kuitansi",key:"kuitansi_created_at"},{label:"User Pembuat",key:"user_name"}
    ];
    if(type==="outstanding-payment")return [
        {label:"No",key:"__no"},{label:"No. Kuitansi",key:"kuitansi_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"No. Klaim",key:"claim_number"},
        {label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Grand Total",key:"grand_total"},{label:"Tanggal Kuitansi",key:"kuitansi_created_at"},{label:"User WO",key:"user_name"}
    ];
    if(type==="pembelian-barang")return [
        {label:"No",key:"__no"},{label:"No. PO",key:"po_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},
        {label:"Nama Sparepart",key:"part_name"},{label:"SKU / No. Part",key:"part_number"},{label:"Qty",key:"quantity"},{label:"Vendor",key:"vendor"},{label:"Harga Beli",key:"buy_price"},{label:"Harga Jual",key:"sell_price"},{label:"Margin",key:"margin"}
    ];
    if(type==="komisi-agent")return [
        {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Customer",key:"customer"},{label:"Asuransi",key:"insurer"},{label:"Nilai Kuitansi Tagihan",key:"nilai_kuitansi"},{label:"Nama Agent",key:"agent_name"},{label:"Nilai Komisi",key:"nilai_komisi"}
    ];
    if(type==="omset")return [
        {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Nilai Kuitansi Tagihan",key:"nilai_kuitansi"},{label:"Netto Harga Beli Sparepart",key:"netto_harga_beli_sparepart"},
        {label:"Total Vendor Produksi",key:"total_vendor_produksi"},{label:"Pemakaian Bahan",key:"pemakaian_bahan"},{label:"Biaya Survey",key:"biaya_survey"},{label:"Komisi Agent",key:"biaya_agent"},{label:"PPN",key:"ppn_amount"},{label:"PPh",key:"pph_amount"},{label:"Margin",key:"income"}
    ];
    if(type==="vendor-produksi")return [
        {label:"No",key:"__no"},{label:"Tanggal Input",key:"input_at"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Nama Pekerja",key:"worker_name"},{label:"Jenis Pekerjaan",key:"worker_type"},{label:"Harga Pekerja",key:"worker_price"}
    ];
    if(type==="penghapusan")return [
        {label:"No",key:"__no"},{label:"No. Estimasi / No. WO",key:"document_number"},{label:"Tanggal",key:"deleted_at"},{label:"Customer",key:"customer"},{label:"Asuransi",key:"insurer"},{label:"Alasan",key:"reason"}
    ];
    if(type==="mobil-keluar")return [
        {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Merek / Type",key:"brand_model"},{label:"Warna",key:"color"},{label:"Check In",key:"check_in_at"},{label:"Check Out",key:"check_out_at"},{label:"Lama di Bengkel",key:"lama_di_bengkel_display"},{label:"Target Selesai",key:"target_date"},{label:"Keterangan Tambahan",key:"keterangan_target"},{label:"Keterangan Check Out",key:"checkout_note"},{label:"User WO",key:"user_name"}
    ];
    return def.head.map((label,i)=>({label,key:"__col"+i}));
}
function pageTotalKeys(type){
    if(type==="own-risk-outstanding")return ["own_risk","free_amount","amount_due","amount_paid","amount_remaining"];
    if(type==="own-risk")return ["own_risk","free_amount","amount_due","amount","total_paid","amount_remaining"];
    if(type==="kuitansi"||type==="outstanding-payment")return ["grand_total"];
    if(type==="komisi-agent")return ["nilai_kuitansi","nilai_komisi"];
    if(type==="pembelian-barang")return ["quantity","buy_price","sell_price","margin"];
    if(type==="omset")return ["nilai_kuitansi","netto_harga_beli_sparepart","total_vendor_produksi","pemakaian_bahan","biaya_survey","biaya_agent","income","ppn_amount","pph_amount"];
    if(type==="vendor-produksi")return ["worker_price"];
    return [];
}
function renderReportResult(type,data){
    const box=$("reportResult"); if(!box)return;
    const def=defs[type], rows=Array.isArray(data)?data:[];
    const periodFrom=def?.from?$(def.from)?.value||"":"", periodTo=def?.to?$(def.to)?.value||"":"";
    const selectedUser=def?.user?$(def.user)?.selectedOptions?.[0]?.textContent||"ALL USER":"";
    const filterParts=[];
    if(periodFrom||periodTo)filterParts.push(`Periode: ${esc(dateOnly(periodFrom)||"-")} s/d ${esc(dateOnly(periodTo)||"-")}`);
    if(selectedUser)filterParts.push(`User: ${esc(selectedUser)}`);
    if(def?.worker)filterParts.push(`Pekerja: ${esc($(def.worker)?.value||"ALL")}`);
    if(def?.vendor)filterParts.push(`Vendor: ${esc($(def.vendor)?.value||"ALL")}`);
    if(def?.agent)filterParts.push(`Agent: ${esc($(def.agent)?.value||"ALL")}`);
    const header=`<div class="report-result-head"><div><h3>${esc(def.title)}</h3><div class="report-result-meta">${filterParts.join(" &nbsp; | &nbsp; ")||"Tanpa filter periode"}</div></div><div class="report-result-meta">${rows.length} data</div></div>`;
    if(!rows.length){box.innerHTML=header+`<div class="report-empty">Tidak ada data untuk filter yang dipilih.</div>`;box.hidden=false;return;}
    const columns=reportColumns(type);
    if(type==="vendor-produksi"){
        const body=vendorGroups(rows).map(([worker,items])=>{
            const tr=items.map((r,i)=>`<tr><td class="center">${i+1}</td>${cells(type,r).map(v=>`<td>${esc(v??"-")}</td>`).join("")}</tr>`).join("");
            return `<tr class="report-group-row"><td colspan="${columns.length}"><strong>Nama Pekerja: ${esc(worker)}</strong></td></tr>${tr}`;
        }).join("");
        box.innerHTML=header+`<table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${body}</tbody></table><button type="button" class="btn-secondary report-back">← Pilih Laporan Lain</button>`;
    }else{
        const body=rows.map((r,i)=>`<tr>${columns.map(c=>`<td class="${c.key==="__no"?"center":""}">${esc(valueFor(type,r,c.key,i)??"-")}</td>`).join("")}</tr>`).join("");
        const keys=new Set(pageTotalKeys(type));
        const totalRow=keys.size?`<tr>${columns.map((c,i)=>{if(i===0)return `<td><strong>TOTAL</strong></td>`;if(!keys.has(c.key))return "<td></td>";const v=rows.reduce((sum,r)=>sum+(Number(r?.[c.key])||0),0);return `<td><strong>${esc(c.key==="quantity"?v:money(v))}</strong></td>`}).join("")}</tr>`:"";
        box.innerHTML=header+`<table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join("")}</tr></thead><tbody>${body}${totalRow}</tbody></table><button type="button" class="btn-secondary report-back">← Pilih Laporan Lain</button>`;
    }
    box.hidden=false;
    box.querySelector(".report-back")?.addEventListener("click",()=>selectReport(""));
}
function selectReport(type){
    selectedReportType=type||"";
    const listView=$("reportListView");
    const pageView=$("reportPageView");
    const pageCard=$("reportPageCard");
    const result=$("reportResult");
    const title=$("reportPageTitle");
    const description=$("reportPageDescription");

    if(!type){
        if(listView)listView.style.display="block";
        if(pageView)pageView.classList.remove("active");
        if(pageCard)pageCard.innerHTML="";
        if(result){result.hidden=true;result.innerHTML="";}
        window.history.pushState({report:""},"",window.location.pathname);
        window.scrollTo({top:0,behavior:"smooth"});
        return;
    }

    const source=document.querySelector(`.report-card[data-report="${CSS.escape(type)}"]`);
    if(!source)return;
    const def=defs[type];
    if(listView)listView.style.display="none";
    if(pageView)pageView.classList.add("active");
    if(title)title.textContent=def.title;
    if(description)description.textContent=source.querySelector("p")?.textContent||"Filter laporan";
    if(pageCard){
        const clone=source.cloneNode(true);
        clone.classList.add("selected");
        clone.setAttribute("aria-expanded","true");
        pageCard.innerHTML="";
        pageCard.appendChild(clone);
    }

    // Pindahkan nilai filter/default dari kartu sumber ke halaman laporan.
    const originalInputs=source.querySelectorAll("input,select");
    const pageInputs=pageCard?.querySelectorAll("input,select")||[];
    pageInputs.forEach((el,i)=>{if(originalInputs[i])el.value=originalInputs[i].value;});

    // Tombol PDF/Excel tetap memanggil fungsi print/export yang sama seperti sebelumnya.
    pageCard?.querySelectorAll("[data-print]").forEach(b=>b.addEventListener("click",async e=>{e.preventDefault();e.stopPropagation();const ok=await load(b.dataset.print);if(ok)print();}));
    pageCard?.querySelectorAll("[data-excel]").forEach(b=>b.addEventListener("click",async e=>{e.preventDefault();e.stopPropagation();const ok=await load(b.dataset.excel);if(ok)exportExcel();}));

    // Filter langsung aktif tanpa tombol Tampilkan Laporan.
    const filterIds=[def.from,def.to,def.user,def.worker,def.vendor,def.agent].filter(Boolean);

    // Sinkronkan filter clone ke elemen yang dibaca fungsi laporan.
    // Listener sinkronisasi dipasang SEBELUM listener load agar perubahan periode
    // yang baru dipilih selalu menjadi nilai yang dikirim ke API.
    const syncFilters=()=>{
        filterIds.forEach(id=>{
            const src=pageCard?.querySelector(`#${CSS.escape(id)}`);
            const dst=$(id);
            if(src&&dst)dst.value=src.value;
        });
    };
    filterIds.forEach(id=>{
        const src=pageCard?.querySelector(`#${CSS.escape(id)}`);
        if(!src)return;
        if(src.tagName==="SELECT"||src.type==="date")src.addEventListener("change",syncFilters);
        else src.addEventListener("input",syncFilters);
    });
    pageCard?.querySelectorAll("input").forEach(src=>{
        if(src.type!=="date")src.addEventListener("input",syncFilters);
    });

    const run=()=>{
        syncFilters();
        return load(type);
    };
    filterIds.forEach(id=>{
        const clone=pageCard?.querySelector(`#${CSS.escape(id)}`);
        if(!clone)return;
        if(clone.tagName==="SELECT"||clone.type==="date")clone.addEventListener("change",run);
        else {
            let timer;
            clone.addEventListener("input",()=>{
                clearTimeout(timer);
                timer=setTimeout(run,350);
            });
            clone.addEventListener("change",run);
        }
    });

    // Vendor/Agent/Worker datalist tetap tersedia dari data yang sudah dimuat.
    window.history.pushState({report:type},"",`${window.location.pathname}?report=${encodeURIComponent(type)}`);
    if(result){result.hidden=false;result.innerHTML='<div class="report-empty">Memuat laporan...</div>';}
    syncFilters();
    load(type);
    window.scrollTo({top:0,behavior:"smooth"});
}
function render(type,data){currentType=type;currentData=data;currentTitle=defs[type].title;renderReportResult(type,data)}
async function load(type){const def=defs[type],q=validate(def);if(!q)return false;try{if(type==="pembelian-barang"){const data=buildPurchaseReport(q.from,q.to,q.vendor);render(type,data);return true}const params=new URLSearchParams();if(!def.noPeriod){params.set("from",q.from);params.set("to",q.to);}if(q.user)params.set("user_id",q.user);if(q.worker)params.set("worker_name",q.worker);if(q.agent)params.set("agent_name",q.agent);const r=await api(def.url+"?"+params.toString());let rows=Array.isArray(r.data)?r.data:[];if(type==="own-risk")rows=enrichOwnRiskRows(rows);if(type==="mobil-keluar")rows=enrichMobilKeluarRows(rows);render(type,rows);if(type==="vendor-produksi")updateWorkerOptions(rows||[]);if(type==="komisi-agent")updateAgentOptions(rows||[]);return true}catch(e){myWorkshopAlert("Gagal memuat laporan.\n\n"+e.message);return false}}
function excelCell(v){return String(v??"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function excelFileName(type){return `MyWorkshop_${String(type).replace(/[^a-z0-9]+/gi,"_")}_${today()}.xls`}
function vendorType(v){const x=String(v||"").trim().toLowerCase();if(x.includes("ketok"))return "Ketok";if(x.includes("dempul"))return "Dempul";if(x.includes("cat"))return "Cat";if(x.includes("poles"))return "Poles";return String(v||"Lainnya")}
function vendorGroups(data){const m=new Map();(data||[]).forEach(r=>{const worker=String(r.worker_name||"Tanpa Nama Pekerja").trim()||"Tanpa Nama Pekerja";if(!m.has(worker))m.set(worker,[]);m.get(worker).push(r)});return Array.from(m.entries()).sort((a,b)=>a[0].localeCompare(b[0],"id"))}
function exportExcel(){
    if(!currentType)return myWorkshopAlert("Pilih laporan terlebih dahulu.");
    const def=defs[currentType],now=new Date();
    const total=(rows,key)=>rows.reduce((sum,r)=>sum+(Number(r?.[key])||0),0);
    const noTotalReports=new Set(["mobil-masuk","mobil-keluar","outstanding-estimasi","outstanding"]);
    const escX=v=>excelCell(v);
    const columnsFor=(type)=>{
        if(type==="outstanding-estimasi")return [
            {label:"No",key:"__no"},{label:"No. Estimasi",key:"estimate_number"},{label:"Tanggal Estimasi",key:"estimate_date"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Merek / Type",key:"brand_model"},{label:"Asuransi",key:"insurer"},{label:"Total yang Ditagihkan",key:"total_billed"}
        ];
        if(type==="own-risk-outstanding")return [
            {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},
            {label:"Total Nilai OR",key:"own_risk"},{label:"Nilai Free",key:"free_amount"},{label:"Nilai Harus Dibayar",key:"amount_due"},{label:"Total Dibayar",key:"amount_paid"},{label:"Hutang / Sisa",key:"amount_remaining"},{label:"Status",key:"status"},{label:"User",key:"user_name"}
        ];
        if(type==="own-risk")return [
            {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},
            {label:"Total Nilai OR",key:"own_risk"},{label:"Nilai Free",key:"free_amount"},{label:"Nilai Harus Dibayar",key:"amount_due"},{label:"Nilai Dibayar",key:"amount"},{label:"Total Dibayar",key:"total_paid"},{label:"Hutang / Sisa",key:"amount_remaining"},{label:"Pembayaran Ke",key:"payment_sequence"},{label:"Metode",key:"payment_method"},{label:"Tanggal Bayar",key:"paid_at"},{label:"Keterangan",key:"payment_description_display"},{label:"Status",key:"payment_status"},{label:"User",key:"user_name"}
        ];
        if(type==="kuitansi")return [
            {label:"No",key:"__no"},{label:"No. Kuitansi",key:"kuitansi_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"No. Klaim",key:"claim_number"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Grand Total",key:"grand_total"},{label:"Tanggal Kuitansi",key:"kuitansi_created_at"},{label:"User Pembuat",key:"user_name"}
        ];
        if(type==="outstanding-payment")return [
            {label:"No",key:"__no"},{label:"No. Kuitansi",key:"kuitansi_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"No. Klaim",key:"claim_number"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Grand Total",key:"grand_total"},{label:"Tanggal Kuitansi",key:"kuitansi_created_at"},{label:"User WO",key:"user_name"}
        ];
        if(type==="pembelian-barang")return [
            {label:"No",key:"__no"},{label:"No. PO",key:"po_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Nama Sparepart",key:"part_name"},{label:"SKU / No. Part",key:"part_number"},{label:"Qty",key:"quantity"},{label:"Vendor",key:"vendor"},{label:"Harga Beli",key:"buy_price"},{label:"Harga Jual",key:"sell_price"},{label:"Margin",key:"margin"}
        ];
        if(type==="komisi-agent")return [
            {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Customer",key:"customer"},{label:"Asuransi",key:"insurer"},{label:"Nilai Kuitansi Tagihan",key:"nilai_kuitansi"},{label:"Nama Agent",key:"agent_name"},{label:"Nilai Komisi",key:"nilai_komisi"}
        ];
        if(type==="omset")return [
            {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Nilai Kuitansi Tagihan",key:"nilai_kuitansi"},{label:"Netto Harga Beli Sparepart",key:"netto_harga_beli_sparepart"},{label:"Total Vendor Produksi",key:"total_vendor_produksi"},{label:"Pemakaian Bahan",key:"pemakaian_bahan"},{label:"Biaya Survey",key:"biaya_survey"},{label:"Komisi Agent",key:"biaya_agent"},{label:"PPN",key:"ppn_amount"},{label:"PPh",key:"pph_amount"},{label:"Margin",key:"income"}
        ];
        if(type==="vendor-produksi")return [
            {label:"No",key:"__no"},{label:"Tanggal Input",key:"input_at"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Nama Pekerja",key:"worker_name"},{label:"Jenis Pekerjaan",key:"worker_type"},{label:"Harga Pekerja",key:"worker_price"}
        ];
        if(type==="penghapusan")return [
            {label:"No",key:"__no"},{label:"No. Estimasi / No. WO",key:"document_number"},{label:"Tanggal",key:"deleted_at"},{label:"Customer",key:"customer"},{label:"Asuransi",key:"insurer"},{label:"Alasan",key:"reason"}
        ];
        if(type==="mobil-keluar")return [
            {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Merek / Type",key:"brand_model"},{label:"Warna",key:"color"},{label:"Check In",key:"check_in_at"},{label:"Check Out",key:"check_out_at"},{label:"Lama di Bengkel",key:"lama_di_bengkel_display"},{label:"Target Selesai",key:"target_date"},{label:"Keterangan Tambahan",key:"keterangan_target"},{label:"Keterangan Check Out",key:"checkout_note"},{label:"User WO",key:"user_name"}
        ];
        return def.head.map((label,i)=>({label,key:"__col"+i}));
    };
    const columns=columnsFor(currentType);
    const moneyKeys=new Set(["own_risk","free_amount","amount_due","amount_paid","amount","total_paid","amount_remaining","grand_total","buy_price","sell_price","margin","nilai_kuitansi","nilai_komisi","netto_harga_beli_sparepart","total_vendor_produksi","pemakaian_bahan","biaya_survey","biaya_agent","income","ppn_amount","pph_amount","worker_price","total_billed"]);
    const valueFor=(type,row,key,i)=>{
        if(key==="__no")return i+1;
        if(key==="insurer")return row.insurer_alias||row.insurerAlias||"-";
        if(key==="customer")return row.customer_name||"";
        if(key==="plate")return row.plate_number||"";
        if(key==="status")return row.payment_status||"";
        if(key==="input_at")return dt(row.input_at);
        if(key==="check_in_at")return dt(row.check_in_at);
        if(key==="check_out_at")return dt(row.check_out_at);
        if(key==="target_date")return row.target_date?dateOnly(row.target_date):"-";
        if(key==="lama_di_bengkel_display")return row.lama_di_bengkel_display||"-";
        if(key==="keterangan_target")return row.keterangan_target||"-";
        if(key==="checkout_note")return row.checkout_note||"";
        if(key==="color")return row.color||"";
        if(key==="brand_model")return `${row.brand||""} ${row.model||""}`.trim();
        if(key==="estimate_number")return row.estimate_number??"";
        if(key==="estimate_date")return dateOnly(row.estimate_date);
        if(key==="customer")return row.customer_name??"";
        if(key==="plate")return row.plate_number??"";
        if(key==="insurer")return row.insurer_alias||row.insurerAlias||"-";
        if(key==="kuitansi_created_at")return dt(row.kuitansi_created_at);
        if(key==="paid_at")return dt(row.paid_at);
        if(key==="payment_description_display")return row.payment_description_display||row.payment_description||"";
        if(key==="part_number")return row.part_number||"-";
        if(key==="vendor")return row.vendor||"-";
        if(key==="worker_type")return row.worker_type||"";
        if(key==="worker_name")return row.worker_name||"";
        if(key==="agent_name")return row.agent_name||"-";
        if(key==="wo_number")return row.wo_number||"";
        if(key==="document_type")return row.document_type||"";
        if(key==="document_number")return row.document_number||"";
        if(key==="deleted_at")return dt(row.deleted_at);
        if(key==="reason")return row.reason||"";
        if(key==="amount_paid")return row.amount_paid??row.total_paid??0;
        if(key==="total_paid")return row.total_paid??0;
        if(key==="amount_remaining")return row.amount_remaining??0;
        if(key==="payment_sequence")return `Ke-${row.payment_sequence||"-"}`;
        if(key==="payment_method")return row.payment_method||"";
        if(key==="quantity")return row.quantity??0;
        if(key==="brand_model")return `${row.brand||""} ${row.model||""}`.trim();
        if(key==="estimate_number")return row.estimate_number??"";
        if(key==="estimate_date")return dateOnly(row.estimate_date);
        if(key==="customer")return row.customer_name??"";
        if(key==="plate")return row.plate_number??"";
        if(key==="insurer")return row.insurer_alias||row.insurerAlias||"-";
        if(key==="__col0"||key==="__col1"||key==="__col2"||key==="__col3"||key==="__col4"||key==="__col5"||key==="__col6"||key==="__col7"||key==="__col8")return cells(type,row)[Number(key.slice(5))]??"";
        const v=row[key];
        return moneyKeys.has(key)?money(v):v??"";
    };
    const makeExcelTotal=(cols,rows)=>{
        if(noTotalReports.has(currentType)||!rows.length)return "";
        const totalKeys=new Set();
        if(currentType==="own-risk-outstanding")["own_risk","free_amount","amount_due","amount_paid","amount_remaining"].forEach(k=>totalKeys.add(k));
        else if(currentType==="own-risk")["own_risk","free_amount","amount_due","amount","total_paid","amount_remaining"].forEach(k=>totalKeys.add(k));
        else if(currentType==="kuitansi"||currentType==="outstanding-payment")totalKeys.add("grand_total");
        else if(currentType==="komisi-agent")["nilai_kuitansi","nilai_komisi"].forEach(k=>totalKeys.add(k));
        else if(currentType==="pembelian-barang")["quantity","buy_price","sell_price","margin"].forEach(k=>totalKeys.add(k));
        else if(currentType==="omset")["nilai_kuitansi","netto_harga_beli_sparepart","total_vendor_produksi","pemakaian_bahan","biaya_survey","biaya_agent","income","ppn_amount","pph_amount"].forEach(k=>totalKeys.add(k));
        else if(currentType==="vendor-produksi")totalKeys.add("worker_price");
        return '<tr>'+cols.map((c,i)=>{
            if(i===0)return '<td><strong>TOTAL</strong></td>';
            if(!totalKeys.has(c.key))return '<td></td>';
            const val=total(rows,c.key);return `<td><strong>${escX(c.key==="quantity"?val:money(val))}</strong></td>`;
        }).join('')+'</tr>';
    };
    const periodFrom=$(def.from)?.value||"",periodTo=$(def.to)?.value||"";
    let html='<!doctype html><html><head><meta charset="utf-8"><style>table{border-collapse:collapse}th,td{border:1px solid #999;padding:4px}th{background:#eee;font-weight:bold}.total td{font-weight:bold;border-top:2px solid #111}</style></head><body>';
    html+=`<table border="1"><tr><th colspan="${columns.length}">MyWorkshop - ${escX(def.title)}</th></tr><tr><td colspan="${columns.length}">Dicetak: ${escX(now.toLocaleString("id-ID"))}</td></tr>`;
    if((currentType==="pembelian-barang"||currentType==="omset"||currentType==="own-risk"||currentType==="outstanding-estimasi"||currentType==="penghapusan")&&(periodFrom||periodTo))html+=`<tr><td colspan="${columns.length}"><strong>Periode: ${escX(periodFrom||"-")} s/d ${escX(periodTo||"-")}</strong></td></tr>`;
    html+='</table><br>';
    if(currentType==="vendor-produksi"){
        vendorGroups(currentData).forEach(([worker,rows])=>{
            html+=`<table border="1"><tr><th colspan="${columns.length}">NAMA PEKERJA: ${escX(worker)}</th></tr>`;
            ["Ketok","Dempul","Cat","Poles","Lainnya"].forEach(type=>{
                const items=rows.filter(r=>vendorType(r.worker_type)===type);if(!items.length)return;
                html+=`<tr><th colspan="${columns.length}">JENIS PEKERJAAN: ${escX(type)}</th></tr><tr>${columns.map(c=>`<th>${escX(c.label)}</th>`).join('')}</tr>`;
                items.forEach((r,i)=>html+='<tr>'+columns.map(c=>`<td>${escX(valueFor(currentType,r,c.key,i))}</td>`).join('')+'</tr>');
                html+=makeExcelTotal(columns,items);
            });
            html+='</table><br>';
        });
    }else{
        html+=`<table border="1"><tr>${columns.map(c=>`<th>${escX(c.label)}</th>`).join('')}</tr>`;
        if(currentData.length)currentData.forEach((r,i)=>html+='<tr>'+columns.map(c=>`<td>${escX(valueFor(currentType,r,c.key,i))}</td>`).join('')+'</tr>');
        else html+=`<tr><td colspan="${columns.length}">Tidak ada data</td></tr>`;
        html+=makeExcelTotal(columns,currentData);
        html+='</table>';
        if(currentType==="mobil-keluar"&&currentData.length){
            const sesuai=currentData.filter(r=>r.keterangan_target==="Sesuai Target").length;
            const lewat=currentData.filter(r=>r.keterangan_target==="Melewati Target").length;
            const noTarget=currentData.length-sesuai-lewat;
            const totalRows=currentData.length||1;
            html+=`<br><table border="1"><tr><th colspan="3">TINGKAT KETEPATAN TARGET</th></tr><tr><th>Keterangan</th><th>Jumlah Kendaraan</th><th>Persentase</th></tr><tr><td>Sesuai Target</td><td>${sesuai}</td><td>${((sesuai/totalRows)*100).toFixed(2)}%</td></tr><tr><td>Melewati Target</td><td>${lewat}</td><td>${((lewat/totalRows)*100).toFixed(2)}%</td></tr>${noTarget?`<tr><td>Target Tidak Tersedia</td><td>${noTarget}</td><td>${((noTarget/totalRows)*100).toFixed(2)}%</td></tr>`:""}</table>`;
        }
        if(currentType==="mobil-keluar"&&currentData.length){
            const sesuai=currentData.filter(r=>r.keterangan_target==="Sesuai Target").length;
            const lewat=currentData.filter(r=>r.keterangan_target==="Melewati Target").length;
            const noTarget=currentData.length-sesuai-lewat;
            const totalRows=currentData.length||1;
            const items=[{name:"Sesuai Target",value:sesuai},{name:"Melewati Target",value:lewat}];
            if(noTarget>0)items.push({name:"Target Tidak Tersedia",value:noTarget});
            const pieTotal=items.reduce((a,x)=>a+x.value,0)||1;
            const pieColors=["#59a14f","#e15759","#edc949"];
            let startAngle=-Math.PI/2;
            const svgSlices=items.map((x,i)=>{
                const fraction=Math.max(0,Number(x.value)||0)/pieTotal;
                const endAngle=startAngle+(fraction*Math.PI*2);
                const x1=50+44*Math.cos(startAngle),y1=50+44*Math.sin(startAngle);
                const x2=50+44*Math.cos(endAngle),y2=50+44*Math.sin(endAngle);
                const largeArc=fraction>0.5?1:0;
                const path=fraction>=0.999999?`<circle cx="50" cy="50" r="44" fill="${pieColors[i%pieColors.length]}"/>`:`<path d="M 50 50 L ${x1.toFixed(3)} ${y1.toFixed(3)} A 44 44 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z" fill="${pieColors[i%pieColors.length]}"/>`;
                startAngle=endAngle;
                return path;
            }).join("");
            const pieSvg=`<svg class="delay-pie-svg" viewBox="0 0 100 100" role="img" aria-label="Diagram pie ketepatan target">${svgSlices}<circle cx="50" cy="50" r="44" fill="none" stroke="#777" stroke-width="0.7"/></svg>`;
            const legend=items.map((x,i)=>`<div class="pie-legend-row"><span class="pie-dot" style="background:${pieColors[i%pieColors.length]}"></span><span class="pie-legend-name">${esc(x.name)}</span><strong>${x.value}</strong><span class="pie-legend-pct">${((x.value/pieTotal)*100).toFixed(2)}%</span></div>`).join("");
            html+=`<br><table border="1"><tr><th colspan="4">TINGKAT KETEPATAN TARGET</th></tr><tr><th colspan="4">Diagram pie tersedia pada hasil cetak PDF.</th></tr><tr><td>Sesuai Target</td><td>${sesuai}</td><td>${((sesuai/pieTotal)*100).toFixed(2)}%</td><td></td></tr><tr><td>Melewati Target</td><td>${lewat}</td><td>${((lewat/pieTotal)*100).toFixed(2)}%</td><td></td></tr>${noTarget?`<tr><td>Target Tidak Tersedia</td><td>${noTarget}</td><td>${((noTarget/pieTotal)*100).toFixed(2)}%</td><td></td></tr>`:""}</table>`;
        }
        if(currentType==="omset"&&currentData.length){
            const insurerTotals=new Map();currentData.forEach(r=>{const n=String(r?.insurer_alias||r?.insurerAlias||r?.insurer_name||r?.insurerName||"-").trim()||"-";insurerTotals.set(n,(insurerTotals.get(n)||0)+(Number(r?.nilai_kuitansi)||0));});
            const ranked=Array.from(insurerTotals.entries()).sort((a,b)=>b[1]-a[1]),top5=ranked.slice(0,5),otherValue=ranked.slice(5).reduce((s,x)=>s+x[1],0),grandTagihan=total(currentData,"nilai_kuitansi");
            const dates=currentData.map(r=>String(r?.kuitansi_created_at||"").slice(0,10)).filter(Boolean).sort(),start=periodFrom||dates[0]||"",end=periodTo||dates[dates.length-1]||start;
            const sd=start?new Date(start+"T00:00:00"):null,ed=end?new Date(end+"T00:00:00"):null,days=sd&&ed&&!Number.isNaN(sd.getTime())&&!Number.isNaN(ed.getTime())?Math.max(1,Math.floor((ed-sd)/86400000)+1):1;
            html+=`<br><table border="1"><tr><th colspan="4">RINGKASAN OMSET</th></tr><tr><th>Keterangan</th><th>Nilai</th><th colspan="2"></th></tr><tr><td>Total Nilai Tagihan</td><td>${escX(money(grandTagihan))}</td><td colspan="2"></td></tr><tr><td>Rata-rata Nilai Tagihan per Hari</td><td>${escX(money(grandTagihan/days))}</td><td colspan="2">${days} hari periode laporan</td></tr><tr><th>Top</th><th>Asuransi</th><th>Nilai Tagihan</th><th>Persentase dari Total</th></tr>`;
            top5.forEach(([n,v],i)=>html+=`<tr><td>${i+1}</td><td>${escX(n)}</td><td>${escX(money(v))}</td><td>${((v/(grandTagihan||1))*100).toFixed(2)}%</td></tr>`);
            if(otherValue>0)html+=`<tr><td>—</td><td><strong>Asuransi yang tidak masuk Top 5</strong></td><td><strong>${escX(money(otherValue))}</strong></td><td><strong>${((otherValue/(grandTagihan||1))*100).toFixed(2)}%</strong></td></tr>`;
            html+='</table>';
        }
    }
    html+='</body></html>';
    const blob=new Blob(["\ufeff",html],{type:"application/vnd.ms-excel;charset=utf-8"}),url=URL.createObjectURL(blob),a=document.createElement("a");a.href=url;a.download=excelFileName(currentType);document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function print(){
    if(!currentType)return myWorkshopAlert("Pilih periode laporan terlebih dahulu.");
    const def=defs[currentType],now=new Date();
    const w=window.open("","_blank","width=1400,height=900");
    if(!w)return myWorkshopAlert("Popup diblokir browser. Izinkan popup untuk mencetak laporan.");
    const workshopHeader=await getWorkshopPrintHeader();

    const total=(rows,key)=>rows.reduce((sum,r)=>sum+(Number(r?.[key])||0),0);
    const fmtTotal=(value,type)=>type==="qty" ? String(Number(value)||0) : money(value);
    const makeTotalRow=(columns, totals)=>{
        return '<tr class="print-total-row">'+columns.map((col,i)=>{
            if(i===0)return '<td><strong>TOTAL</strong></td>';
            const t=totals[col.key];
            return '<td>'+(t ? '<strong>'+esc(fmtTotal(t.value,t.type))+'</strong>' : '')+'</td>';
        }).join('')+'</tr>';
    };

    let body="";

    if(currentType==="vendor-produksi"){
        body=vendorGroups(currentData).map(([worker,rows])=>{
            const sections=["Ketok","Dempul","Cat","Poles","Lainnya"].map(type=>{
                const items=rows.filter(r=>vendorType(r.worker_type)===type);
                if(!items.length)return "";
                const columns=[
                    {label:"No",key:"__no"},{label:"Tanggal Input",key:"input_at"},{label:"No. WO",key:"wo_number"},
                    {label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},
                    {label:"Nama Pekerja",key:"worker_name"},{label:"Jenis Pekerjaan",key:"worker_type"},{label:"Harga Pekerja",key:"worker_price"}
                ];
                const tr=items.map((r,i)=>'<tr><td>'+(i+1)+'</td>'+cells(currentType,r).map(v=>`<td>${esc(v??"-")}</td>`).join('')+'</tr>').join('');
                const totalRow=makeTotalRow(columns,{worker_price:{value:total(items,"worker_price"),type:"money"}});
                return `<h3>Jenis Pekerjaan: ${esc(type)}</h3><table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${tr}${totalRow}</tbody></table>`;
            }).join('');
            return `<section class="worker-page"><div class="worker-name">NAMA PEKERJA: ${esc(worker)}</div>${sections||'<p>Tidak ada data.</p>'}</section>`;
        }).join('');
    }else{
        let columns=[];
        if(currentType==="outstanding-estimasi"){
            columns=[
                {label:"No",key:"__no"},{label:"No. Estimasi",key:"estimate_number"},{label:"Tanggal Estimasi",key:"estimate_date"},{label:"Customer",key:"customer"},
                {label:"No. Polisi",key:"plate"},{label:"Merek / Type",key:"brand_model"},{label:"Asuransi",key:"insurer"},{label:"Total yang Ditagihkan",key:"total_billed"}
            ];
        }else if(currentType==="own-risk-outstanding"){
            columns=[
                {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},
                {label:"No. Polisi",key:"plate"},{label:"Total Nilai OR",key:"own_risk"},{label:"Nilai Free",key:"free_amount"},{label:"Nilai Harus Dibayar",key:"amount_due"},
                {label:"Total Dibayar",key:"amount_paid"},{label:"Hutang / Sisa",key:"amount_remaining"},{label:"Status",key:"status"},{label:"User",key:"user_name"}
            ];
        }else if(currentType==="own-risk"){
            columns=[
                {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},
                {label:"No. Polisi",key:"plate"},{label:"Total Nilai OR",key:"own_risk"},{label:"Nilai Free",key:"free_amount"},{label:"Nilai Harus Dibayar",key:"amount_due"},
                {label:"Nilai Dibayar",key:"amount"},{label:"Total Dibayar",key:"total_paid"},{label:"Hutang / Sisa",key:"amount_remaining"},{label:"Pembayaran Ke",key:"payment_sequence"},
                {label:"Metode",key:"payment_method"},{label:"Tanggal Bayar",key:"paid_at"},{label:"Keterangan",key:"payment_description_display"},{label:"Status",key:"payment_status"},{label:"User",key:"user_name"}
            ];
        }else if(currentType==="kuitansi"){
            columns=[
                {label:"No",key:"__no"},{label:"No. Kuitansi",key:"kuitansi_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"No. Klaim",key:"claim_number"},
                {label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Grand Total",key:"grand_total"},
                {label:"Tanggal Kuitansi",key:"kuitansi_created_at"},{label:"User Pembuat",key:"user_name"}
            ];
        }else if(currentType==="outstanding-payment"){
            columns=[
                {label:"No",key:"__no"},{label:"No. Kuitansi",key:"kuitansi_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"No. Klaim",key:"claim_number"},
                {label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Grand Total",key:"grand_total"},{label:"Tanggal Kuitansi",key:"kuitansi_created_at"},{label:"User WO",key:"user_name"}
            ];
        }else if(currentType==="pembelian-barang"){
            columns=[
                {label:"No",key:"__no"},{label:"No. PO",key:"po_number"},{label:"No. WO",key:"wo_number"},
                {label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Nama Sparepart",key:"part_name"},
                {label:"SKU / No. Part",key:"part_number"},{label:"Qty",key:"quantity"},{label:"Vendor",key:"vendor"},{label:"Harga Beli",key:"buy_price"},{label:"Harga Jual",key:"sell_price"},{label:"Margin",key:"margin"}
            ];
        }else if(currentType==="komisi-agent"){
            columns=[
                {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Customer",key:"customer"},
                {label:"Asuransi",key:"insurer"},{label:"Nilai Kuitansi Tagihan",key:"nilai_kuitansi"},{label:"Nama Agent",key:"agent_name"},{label:"Nilai Komisi",key:"nilai_komisi"}
            ];
        }else if(currentType==="omset"){
            // Tanggal Kuitansi hanya ditampilkan sebagai periode di header, bukan sebagai kolom tabel.
            columns=[
                {label:"No",key:"__no"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"Customer",key:"customer"},
                {label:"No. Polisi",key:"plate"},{label:"Nilai Kuitansi Tagihan",key:"nilai_kuitansi"},{label:"Netto Harga Beli Sparepart",key:"netto_harga_beli_sparepart"},
                {label:"Total Vendor Produksi",key:"total_vendor_produksi"},{label:"Pemakaian Bahan",key:"pemakaian_bahan"},{label:"Biaya Survey",key:"biaya_survey"},
                {label:"Komisi Agent",key:"biaya_agent"},{label:"PPN",key:"ppn_amount"},{label:"PPh",key:"pph_amount"},{label:"Margin",key:"income"}
            ];
        }else{
            columns=def.head.map((label,i)=>({label,key:"__col"+i}));
        }

        const printRows=currentData.map((r,i)=>{
            let vals=cells(currentType,r);
            if(currentType==="omset") vals=[vals[1],vals[2],vals[3],vals[4],vals[5],vals[6],vals[11],vals[12],vals[13],vals[14],vals[15],vals[16],vals[17]];
            return '<tr><td>'+(i+1)+'</td>'+vals.map(v=>`<td>${esc(v??"-")}</td>`).join('')+'</tr>';
        }).join('');

        const totals={};
        if(currentType==="own-risk-outstanding"){
            ["own_risk","free_amount","amount_due","amount_paid","amount_remaining"].forEach(key=>totals[key]={value:total(currentData,key),type:"money"});
        }else if(currentType==="own-risk"){
            ["own_risk","free_amount","amount_due","amount","amount_remaining"].forEach(key=>totals[key]={value:total(currentData,key),type:"money"});totals.total_paid={value:total(currentData,"amount"),type:"money"};
        }else if(currentType==="kuitansi"){
            totals.grand_total={value:total(currentData,"grand_total"),type:"money"};
        }else if(currentType==="outstanding-payment"){
            totals.grand_total={value:total(currentData,"grand_total"),type:"money"};
        }else if(currentType==="komisi-agent"){
            totals.nilai_kuitansi={value:total(currentData,"nilai_kuitansi"),type:"money"};
            totals.nilai_komisi={value:total(currentData,"nilai_komisi"),type:"money"};
        }else if(currentType==="outstanding-payment"){
            columns=[
                {label:"No",key:"__no"},{label:"No. Kuitansi",key:"kuitansi_number"},{label:"No. WO",key:"wo_number"},{label:"Asuransi",key:"insurer"},{label:"No. Klaim",key:"claim_number"},
                {label:"Customer",key:"customer"},{label:"No. Polisi",key:"plate"},{label:"Grand Total",key:"grand_total"},{label:"Tanggal Kuitansi",key:"kuitansi_created_at"},{label:"User WO",key:"user_name"}
            ];
        }else if(currentType==="pembelian-barang"){
            totals.quantity={value:total(currentData,"quantity"),type:"qty"};
            totals.buy_price={value:total(currentData,"buy_price"),type:"money"};
            totals.sell_price={value:total(currentData,"sell_price"),type:"money"};
            totals.margin={value:total(currentData,"margin"),type:"money"};
        }else if(currentType==="omset"){
            ["nilai_kuitansi","netto_harga_beli_sparepart","total_vendor_produksi","pemakaian_bahan","biaya_survey","biaya_agent","income","ppn_amount","pph_amount"].forEach(key=>totals[key]={value:total(currentData,key),type:"money"});
        }
        const noTotalReports=new Set(["mobil-masuk","mobil-keluar","outstanding-estimasi","outstanding"]);
        const totalRow=!noTotalReports.has(currentType) && currentData.length?makeTotalRow(columns,totals):'';
        const periodFrom=$(def.from)?.value||"";
        const periodTo=$(def.to)?.value||"";
        const period=(currentType==="pembelian-barang" || currentType==="omset" || currentType==="own-risk" || currentType==="outstanding-estimasi") && (periodFrom||periodTo)?`<div class="period">Periode: ${esc(periodFrom||"-")} s/d ${esc(periodTo||"-")}</div>`:'';
        body=`<table><thead><tr>${columns.map(c=>`<th>${esc(c.label)}</th>`).join('')}</tr></thead><tbody>${printRows||`<tr><td colspan="${columns.length}" style="text-align:center">Tidak ada data</td></tr>`}${totalRow}</tbody></table>`;
        if(currentType==="omset" && currentData.length){
            const insurerTotals=new Map();
            currentData.forEach(r=>{
                const name=String(r?.insurer_alias||r?.insurerAlias||r?.insurer_name||r?.insurerName||"-").trim()||"-";
                const value=Number(r?.nilai_kuitansi)||0;
                insurerTotals.set(name,(insurerTotals.get(name)||0)+value);
            });
            const ranked=Array.from(insurerTotals.entries()).sort((a,b)=>b[1]-a[1]);
            const top5=ranked.slice(0,5);
            const otherValue=ranked.slice(5).reduce((sum,x)=>sum+x[1],0);
            const pieItems=top5.map(([name,value])=>({name,value}));
            if(otherValue>0)pieItems.push({name:"Asuransi Lainnya",value:otherValue});
            const grandTagihan=total(currentData,"nilai_kuitansi");
            const dates=currentData.map(r=>String(r?.kuitansi_created_at||r?.kuitansiCreatedAt||"").slice(0,10)).filter(Boolean).sort();
            const start=periodFrom||dates[0]||"";
            const end=periodTo||dates[dates.length-1]||start;
            const startDate=start?new Date(start+"T00:00:00"):null;
            const endDate=end?new Date(end+"T00:00:00"):null;
            const periodDays=startDate&&endDate&&!Number.isNaN(startDate.getTime())&&!Number.isNaN(endDate.getTime())?Math.max(1,Math.floor((endDate-startDate)/86400000)+1):1;
            const avgPerDay=grandTagihan/periodDays;
            const pieTotal=pieItems.reduce((sum,x)=>sum+x.value,0)||1;
            let cursor=0;
            const stops=pieItems.map((x,i)=>{const next=cursor+(x.value/pieTotal)*100;const stop=`var(--pie-${i}) ${cursor.toFixed(4)}% ${next.toFixed(4)}%`;cursor=next;return stop;}).join(",");
            const legend=pieItems.map((x,i)=>`<div class="pie-legend-row"><span class="pie-dot" style="background:var(--pie-${i})"></span><span class="pie-legend-name">${esc(x.name)}</span><strong>${esc(money(x.value))}</strong><span class="pie-legend-pct">${((x.value/pieTotal)*100).toFixed(2)}%</span></div>`).join('');
            const topRows=top5.map(([name,value],i)=>`<tr><td>${i+1}</td><td>${esc(name)}</td><td style="text-align:right">${esc(money(value))}</td><td style="text-align:right">${((value/(grandTagihan||1))*100).toFixed(2)}%</td></tr>`).join('') + (otherValue>0 ? `<tr class="other-insurer-row"><td>—</td><td>Asuransi yang tidak masuk Top 5</td><td style="text-align:right">${esc(money(otherValue))}</td><td style="text-align:right">${((otherValue/(grandTagihan||1))*100).toFixed(2)}%</td></tr>` : '');
            body+=`<section class="omset-summary"><h2>RINGKASAN OMSET</h2><div class="omset-average"><div><span>Total Nilai Tagihan</span><strong>${esc(money(grandTagihan))}</strong></div><div><span>Rata-rata Nilai Tagihan per Hari</span><strong>${esc(money(avgPerDay))}</strong><small>${periodDays} hari periode laporan</small></div></div><div class="omset-chart-wrap"><div><h3>Top 5 Asuransi berdasarkan Nilai Tagihan</h3><div class="pie-chart" style="background:conic-gradient(${stops})"></div></div><div class="pie-legend">${legend}</div></div><div class="top5-table"><h3>Top 5 Asuransi</h3><table><thead><tr><th>Top</th><th>Asuransi</th><th>Nilai Tagihan</th><th>Persentase dari Total</th></tr></thead><tbody>${topRows}</tbody></table></div></section>`;
        }
        body=period+body;
        if(currentType==="mobil-keluar" && currentData.length){
            const sesuai=currentData.filter(r=>r.keterangan_target==="Sesuai Target").length;
            const lewat=currentData.filter(r=>r.keterangan_target==="Melewati Target").length;
            const noTarget=currentData.length-sesuai-lewat;
            const items=[{name:"Sesuai Target",value:sesuai},{name:"Melewati Target",value:lewat}];
            if(noTarget>0)items.push({name:"Target Tidak Tersedia",value:noTarget});
            const pieTotal=items.reduce((a,x)=>a+x.value,0)||1;
            const pieColors=["#59a14f","#e15759","#edc949"];
            let startAngle=-Math.PI/2;
            const svgSlices=items.map((x,i)=>{
                const fraction=Math.max(0,Number(x.value)||0)/pieTotal;
                const endAngle=startAngle+(fraction*Math.PI*2);
                const x1=50+44*Math.cos(startAngle),y1=50+44*Math.sin(startAngle);
                const x2=50+44*Math.cos(endAngle),y2=50+44*Math.sin(endAngle);
                const largeArc=fraction>0.5?1:0;
                const path=fraction>=0.999999
                    ? `<circle cx="50" cy="50" r="44" fill="${pieColors[i%pieColors.length]}"/>`
                    : `<path d="M 50 50 L ${x1.toFixed(3)} ${y1.toFixed(3)} A 44 44 0 ${largeArc} 1 ${x2.toFixed(3)} ${y2.toFixed(3)} Z" fill="${pieColors[i%pieColors.length]}"/>`;
                startAngle=endAngle;
                return path;
            }).join("");
            const pieSvg=`<svg class="delay-pie-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="150" height="150" role="img" aria-label="Diagram pie ketepatan target">${svgSlices}<circle cx="50" cy="50" r="44" fill="none" stroke="#555" stroke-width="0.8"/></svg>`;
            const legend=items.map((x,i)=>`<div class="pie-legend-row"><span class="pie-dot" style="background:${pieColors[i%pieColors.length]}"></span><span class="pie-legend-name">${esc(x.name)}</span><strong>${x.value}</strong><span class="pie-legend-pct">${((x.value/pieTotal)*100).toFixed(2)}%</span></div>`).join("");
            body+=`<section class="delay-summary"><h2>TINGKAT KETEPATAN TARGET</h2><div class="delay-chart-wrap"><div class="delay-chart"><h3>Ketepatan Waktu Mobil Keluar</h3>${pieSvg}</div><div class="pie-legend">${legend}</div></div></section>`;
        }
    }

    w.document.write(`<!doctype html><html lang="id"><head><meta charset="utf-8"><title>${esc(def.title)} - MyWorkshop</title><style>@page{size:A4 landscape;margin:12mm 10mm 14mm}*{box-sizing:border-box}html,body{margin:0;padding:0}body{print-color-adjust:exact;-webkit-print-color-adjust:exact;font-family:Arial,sans-serif;color:#111;font-size:10px;padding-top:39mm;padding-bottom:9mm}.print-header{position:fixed;top:0;left:0;right:0;height:36mm;background:#fff;z-index:10;padding-bottom:5mm}.head{display:flex;justify-content:space-between;border-bottom:1px solid #111;padding-bottom:6px}.brand{font-size:18px;font-weight:700}.sub{font-size:10px;color:#555}.title{text-align:center;font-size:15px;font-weight:700;margin:7px 0 3px}.meta{text-align:center;font-size:9px;color:#555;margin-bottom:4px}.period{text-align:center;font-size:10px;font-weight:700;margin:0 0 10px}.print-footer{position:absolute;left:0;right:0;height:8mm;background:#fff;text-align:right;font-size:8px;padding-top:2mm;z-index:10}.page-number{display:block}table{width:100%;border-collapse:collapse;margin-bottom:14px}thead{display:table-header-group}tfoot{display:table-footer-group}tr{break-inside:avoid;page-break-inside:avoid}th,td{border:1px solid #999;padding:5px;vertical-align:top;text-align:left}th{background:#eee;font-size:8px;text-transform:uppercase}td{font-size:8px}.print-total-row td{font-weight:700;border-top:2px solid #111;background:#f5f5f5}.omset-summary{print-color-adjust:exact;-webkit-print-color-adjust:exact;--pie-0:#4e79a7;--pie-1:#f28e2b;--pie-2:#e15759;--pie-3:#76b7b2;--pie-4:#59a14f;--pie-5:#edc949;page-break-inside:avoid;break-inside:avoid;margin-top:12px;border-top:2px solid #111;padding-top:8px}.omset-summary h2{font-size:13px;margin:0 0 7px;text-align:center}.omset-summary h3{font-size:10px;margin:0 0 6px;background:#eee;padding:5px}.omset-average{display:flex;gap:10px;margin-bottom:10px}.omset-average>div{flex:1;border:1px solid #999;padding:7px;text-align:center}.omset-average span{display:block;font-size:8px;text-transform:uppercase}.omset-average strong{display:block;font-size:12px;margin-top:3px}.omset-average small{display:block;font-size:7px;color:#555;margin-top:2px}.omset-chart-wrap{display:flex;gap:18px;align-items:center;margin-bottom:10px}.omset-chart-wrap>div:first-child{width:43%}.pie-chart{print-color-adjust:exact;-webkit-print-color-adjust:exact;width:125px;height:125px;border-radius:50%;margin:8px auto;border:1px solid #777}.pie-legend{flex:1}.pie-legend-row{display:grid;grid-template-columns:10px 1fr auto 48px;gap:5px;align-items:center;font-size:8px;padding:3px 0;border-bottom:1px dotted #bbb}.pie-dot{print-color-adjust:exact;-webkit-print-color-adjust:exact;width:8px;height:8px;border-radius:50%;display:block}.pie-legend-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pie-legend-pct{text-align:right}.top5-table{margin-top:6px}.top5-table table{margin-bottom:0}.top5-table th,.top5-table td{font-size:8px}.other-insurer-row td{font-weight:700;border-top:2px solid #777;background:#f5f5f5;print-color-adjust:exact;-webkit-print-color-adjust:exact}.delay-summary{print-color-adjust:exact;-webkit-print-color-adjust:exact;--delay-0:#59a14f;--delay-1:#e15759;--delay-2:#edc949;page-break-inside:avoid;break-inside:avoid;margin-top:12px;border-top:2px solid #111;padding-top:8px}.delay-summary h2{font-size:13px;margin:0 0 7px;text-align:center}.delay-chart-wrap{display:flex;gap:18px;align-items:center}.delay-chart-wrap>div:first-child{width:43%}.delay-chart{display:block;min-height:155px;text-align:center}.delay-pie-svg{display:block;width:150px;height:150px;margin:8px auto;overflow:visible;print-color-adjust:exact;-webkit-print-color-adjust:exact}.delay-pie-svg path,.delay-pie-svg circle{print-color-adjust:exact;-webkit-print-color-adjust:exact}.worker-page{page-break-after:always;break-after:page}.worker-page:last-child{page-break-after:auto;break-after:auto}.worker-name{font-size:14px;font-weight:700;border-bottom:2px solid #111;padding:7px 0;margin:10px 0}h3{font-size:11px;margin:12px 0 5px;background:#eee;padding:5px}</style></head><body><div class="print-header"><div class="head">${workshopHeader}<div style="text-align:right">Dicetak: ${esc(now.toLocaleString("id-ID"))}</div></div><div class="title">${esc(def.title)}</div><div class="meta">Jumlah data: ${currentData.length}</div></div>${body}<div id="page-footers"></div></body></html>`);
    w.document.close();
    w.focus();
    setTimeout(()=>{
        try{
            const PAGE_HEIGHT_PX = 210 * 96 / 25.4;
            const TOP_MARGIN_PX = 12 * 96 / 25.4;
            const BOTTOM_MARGIN_PX = 14 * 96 / 25.4;
            const FOOTER_HEIGHT_PX = 8 * 96 / 25.4;
            const printableHeight = PAGE_HEIGHT_PX - TOP_MARGIN_PX - BOTTOM_MARGIN_PX;
            const totalPages = Math.max(1, Math.ceil((w.document.documentElement.scrollHeight - TOP_MARGIN_PX) / printableHeight));
            const footers = w.document.getElementById("page-footers");
            footers.innerHTML = Array.from({length:totalPages},(_,i)=>`<div class="print-footer" style="top:${Math.max(0,((i+1)*printableHeight)+TOP_MARGIN_PX-FOOTER_HEIGHT_PX)}px"><span class="page-number">Page ${i+1} of ${totalPages}</span></div>`).join("");
            w.focus();
            w.print();
        }catch(e){console.error("Gagal membuka dialog cetak",e)}
    },700);
}

function normalizeSupply(item){return String(item?.supply_bengkel??item?.supplyBengkel??item?.supply??"BENGKEL").trim().toUpperCase()}
function woParts(wo){const a=wo?.spareparts||wo?.sparepart||wo?.items_sparepart||[];return Array.isArray(a)?a.filter(x=>normalizeSupply(x)==="BENGKEL"):[]}
function woId(wo){return String(wo?.id??wo?.wo_id??wo?.wo_number??"")}
function woNumber(wo){return String(wo?.wo_number??wo?.woNumber??wo?.number??"-")}
async function loadPurchaseSources(){
    purchaseWOData=[];
    purchasePOData=[];
    try{const r=await api("/api/wo");purchaseWOData=Array.isArray(r.data)?r.data:[]}catch(e){console.error("Gagal memuat WO dari database pusat",e)}
    try{const r=await api("/api/storage/purchase_orders");purchasePOData=Array.isArray(r.data)?r.data:[]}catch(e){console.error("Gagal memuat Purchase Order bengkel",e)}
    updateVendorOptions();
}

function purchasePO(wo){
    const id=woId(wo);
    const number=woNumber(wo);
    return purchasePOData.find(po=>{
        const poWoId=String(po?.wo_id??po?.woId??"");
        const poWoNumber=String(po?.wo_number??po?.woNumber??"");
        return (id && poWoId===id) || (number && poWoNumber===number);
    })||null;
}
function normPart(v){return String(v??"").trim().replace(/\s+/g," ").toUpperCase()}
function partMatches(part,item){
    const partName=normPart(part?.part_name??part?.partName??part?.name);
    const itemName=normPart(item?.name??item?.part_name??item?.partName);
    const partNo=normPart(part?.part_number??part?.partNumber??part?.sku);
    const itemNo=normPart(item?.sku??item?.part_number??item?.partNumber);
    const qty=Number(part?.quantity??part?.qty??0);
    const itemQty=Number(item?.quantity??item?.qty??0);
    if(!partName || !itemName || partName!==itemName)return false;
    if(partNo || itemNo){if(partNo!==itemNo)return false;}
    return !qty || !itemQty || qty===itemQty;
}
function buildPurchaseReport(from,to,vendorFilter){
    const result=[];
    const filter=String(vendorFilter||"").trim().toLowerCase();
    const usedByPO=new Map();
    purchaseWOData.forEach(wo=>{
        const po=purchasePO(wo);
        if(!po)return;
        const items=Array.isArray(po?.items)?po.items:[];
        if(!items.length)return;
        const rawDate=po?.created_at||po?.createdAt||po?.updated_at||po?.updatedAt;
        const date=String(rawDate||"").slice(0,10);
        if(!date||date<from||date>to)return;
        const bengkelParts=woParts(wo);
        const used=usedByPO.get(String(po?.id??po?.po_number??woId(wo)))||new Set();
        items.forEach((item,itemIndex)=>{
            const vendor=String(item?.vendor||"Belum PO").trim()||"Belum PO";
            if(filter&&!vendor.toLowerCase().includes(filter))return;
            let partIndex=-1;
            if(item?.item_id!=null || item?.itemId!=null){
                const wanted=String(item?.item_id??item?.itemId);
                partIndex=bengkelParts.findIndex((part,i)=>!used.has(i)&&String(part?.id??"")===wanted);
            }
            if(partIndex<0)partIndex=bengkelParts.findIndex((part,i)=>!used.has(i)&&partMatches(part,item));
            const part=partIndex>=0?bengkelParts[partIndex]:null;
            if(partIndex>=0)used.add(partIndex);
            const qty=Number(item?.quantity??part?.quantity??part?.qty??0)||0;
            const buy=Number(item?.net_buy_price??item?.buy_price??item?.price??0)||0;
            const sellPrice=Number(item?.net_sell_price??item?.netto_harga_jual??item?.nettoHargaJual??item?.harga_jual??item?.hargaJual??item?.sell_price??item?.sellPrice??0)||0;
            const margin=Number(item?.margin ?? (sellPrice-buy))||0;
            result.push({
                purchase_date:rawDate,
                po_number:po?.po_number||"-",
                wo_number:woNumber(wo),
                estimate_number:wo?.estimate_number??wo?.estimateNumber??wo?.noEstimasi??po?.estimate_number??"-",
                insurer_alias:wo?.insurer_alias??wo?.insurerAlias??po?.insurer_alias??po?.insurerAlias??"",
                insurer_name:wo?.insurer_name??po?.insurer_name??"",
                customer_name:wo?.customer_name??wo?.customerName??wo?.customer??po?.customer_name??"-",
                plate_number:wo?.plate_number??wo?.plateNumber??wo?.plate??po?.plate_number??"-",
                part_name:item?.name??item?.part_name??item?.partName??part?.part_name??part?.partName??"-",
                part_number:item?.sku??item?.part_number??item?.partNumber??part?.part_number??part?.partNumber??"-",
                quantity:qty,
                vendor,
                buy_price:buy,
                sell_price:sellPrice,
                margin
            });
        });
        usedByPO.set(String(po?.id??po?.po_number??woId(wo)),used);
    });
    return result.sort((a,b)=>String(a.purchase_date).localeCompare(String(b.purchase_date))||String(a.wo_number).localeCompare(String(b.wo_number))||String(a.po_number).localeCompare(String(b.po_number)));
}
function updateVendorOptions(){const dl=$("beliVendorOptions");if(!dl)return;const names=new Set();purchasePOData.forEach(po=>(Array.isArray(po?.items)?po.items:[]).forEach(x=>{const v=String(x?.vendor||"").trim();if(v)names.add(v)}));dl.innerHTML=Array.from(names).sort((a,b)=>a.localeCompare(b,"id")).map(v=>`<option value="${esc(v)}"></option>`).join("")}
function updateAgentOptions(data){const dl=$("komisiAgentOptions");if(!dl)return;const names=new Set((data||[]).map(x=>String(x?.agent_name||"").trim()).filter(Boolean));dl.innerHTML=Array.from(names).sort((a,b)=>a.localeCompare(b,"id")).map(v=>`<option value="${esc(v)}"></option>`).join("")}
function updateWorkerOptions(data){const dl=$("vendorWorkerOptions");if(!dl)return;const names=new Set((data||[]).map(x=>String(x?.worker_name||"").trim()).filter(Boolean));dl.innerHTML=Array.from(names).sort((a,b)=>a.localeCompare(b,"id")).map(v=>`<option value="${esc(v)}"></option>`).join("")}
async function loadWorkerOptions(){try{const t=today();const r=await api(`/api/laporan/vendor-produksi?from=2000-01-01&to=${encodeURIComponent(t)}`);updateWorkerOptions(r.data||[])}catch(e){console.warn("Gagal memuat daftar nama pekerja",e)}}
document.addEventListener("DOMContentLoaded",async()=>{
    if($("currentDate"))$("currentDate").textContent=new Date().toLocaleDateString("id-ID",{weekday:"long",day:"2-digit",month:"long",year:"numeric"});
    defaults();
    await loadUsers();
    await loadPurchaseSources();
    await loadWorkerOptions();

    document.querySelectorAll(".report-card[data-report]").forEach(card=>{
        card.setAttribute("role","button");
        card.setAttribute("aria-expanded","false");
        card.addEventListener("click",event=>{
            if(event.target.closest("button,input,select,textarea,a,datalist"))return;
            selectReport(card.dataset.report||"");
        });
    });

    $("reportPageBack")?.addEventListener("click",()=>selectReport(""));
    window.addEventListener("popstate",()=>{
        const type=new URLSearchParams(window.location.search).get("report")||"";
        selectReport(type);
    });
    const initialReport=new URLSearchParams(window.location.search).get("report")||"";
    if(initialReport && defs[initialReport])selectReport(initialReport);
});
window.loadLaporan=load;window.printLaporan=print;window.exportLaporanExcel=exportExcel;
})();
