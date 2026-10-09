// ============================================================
// MYWORKSHOP - MOBIL MASUK
// ============================================================

let mobilMasukData = [];

function escapeMobilMasuk(value) {
    return String(value ?? "")
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
}

function formatMobilMasukDate(value) {
    if (!value) return "-";
    const raw = String(value).replace("T", " ");
    const date = new Date(raw.includes("Z") ? raw : raw + "Z");
    if (Number.isNaN(date.getTime())) return String(value).slice(0, 10);
    return date.toLocaleDateString("id-ID", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function ensureMobilMasukDialog() {
    if (document.getElementById("mobilMasukDialog")) return;
    const style = document.createElement("style");
    style.id = "mobilMasukDialogStyle";
    style.textContent = `
        .mobil-masuk-dialog-backdrop{position:fixed;inset:0;background:rgba(0,0,0,.45);display:none;align-items:center;justify-content:center;z-index:100000;padding:20px}
        .mobil-masuk-dialog-backdrop.show{display:flex}
        .mobil-masuk-dialog{width:min(430px,100%);background:#fff;border-radius:12px;box-shadow:0 18px 55px rgba(0,0,0,.25);padding:24px;text-align:center}
        .mobil-masuk-dialog h3{margin:0 0 10px;color:#2563eb;font-size:20px}
        .mobil-masuk-dialog p{margin:0 0 20px;color:#333;line-height:1.5;white-space:pre-line}
        .mobil-masuk-dialog-actions{display:flex;gap:10px;justify-content:center}
        .mobil-masuk-dialog-actions button{border:0;border-radius:7px;padding:9px 18px;font-weight:700;cursor:pointer}
        .mobil-masuk-dialog-cancel{background:#e9ecef;color:#222}
        .mobil-masuk-dialog-ok{background:#2563eb;color:#fff}
    `;
    document.head.appendChild(style);
    const dialog = document.createElement("div");
    dialog.id = "mobilMasukDialog";
    dialog.className = "mobil-masuk-dialog-backdrop";
    dialog.innerHTML = `
        <div class="mobil-masuk-dialog" role="dialog" aria-modal="true" aria-labelledby="mobilMasukDialogTitle">
            <h3 id="mobilMasukDialogTitle">Informasi</h3>
            <p id="mobilMasukDialogMessage"></p>
            <div class="mobil-masuk-dialog-actions">
                <button type="button" class="mobil-masuk-dialog-cancel" id="mobilMasukDialogCancel">Batal</button>
                <button type="button" class="mobil-masuk-dialog-ok" id="mobilMasukDialogOk">OK</button>
            </div>
        </div>`;
    document.body.appendChild(dialog);
    dialog.addEventListener("click", event => {
        if (event.target === dialog) closeMobilMasukDialog();
    });
}

function closeMobilMasukDialog() {
    document.getElementById("mobilMasukDialog")?.classList.remove("show");
}

function showMobilMasukSuccess(message) {
    if (typeof window.myWorkshopAlert === "function") {
        window.myWorkshopAlert(message || "Berhasil.", "success");
        return;
    }

    const existing = document.getElementById("mobilMasukSuccessModal");
    if (existing) existing.remove();
    const modal = document.createElement("div");
    modal.id = "mobilMasukSuccessModal";
    modal.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,Helvetica,sans-serif;";
    modal.innerHTML = `
        <style>@keyframes mwMobilSuccessPop{0%{transform:scale(.55);opacity:.2}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}</style>
        <div style="width:min(460px,100%);background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;box-sizing:border-box;text-align:center">
            <div style="width:64px;height:64px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:0 6px 18px rgba(34,197,94,.25);animation:mwMobilSuccessPop .35s ease-out">
                <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>
            </div>
            <div style="font-size:18px;font-weight:700;color:#15803d;margin-bottom:10px">Berhasil</div>
            <div style="font-size:14px;color:#374151;line-height:1.55;white-space:pre-line">${escapeMobilMasuk(message || "Berhasil.")}</div>
        </div>`;
    document.body.appendChild(modal);
    setTimeout(() => modal.remove(), 1500);
}

function showMobilMasukDialog(message, options = {}) {
    if (!options.confirm && String(options.title || "").toLowerCase() === "berhasil") {
        showMobilMasukSuccess(message);
        return;
    }
    ensureMobilMasukDialog();
    const dialog = document.getElementById("mobilMasukDialog");
    const title = document.getElementById("mobilMasukDialogTitle");
    const text = document.getElementById("mobilMasukDialogMessage");
    const cancel = document.getElementById("mobilMasukDialogCancel");
    const ok = document.getElementById("mobilMasukDialogOk");
    title.textContent = options.title || "Informasi";
    text.textContent = message || "";
    cancel.style.display = options.confirm ? "inline-block" : "none";
    ok.textContent = options.confirm ? "Hapus" : "OK";
    ok.style.background = "#2563eb";
    ok.onclick = async () => {
        if (options.confirm && typeof options.onConfirm === "function") {
            closeMobilMasukDialog();
            await options.onConfirm();
            return;
        }
        closeMobilMasukDialog();
    };
    cancel.onclick = closeMobilMasukDialog;
    dialog.classList.add("show");
    setTimeout(() => (options.confirm ? cancel : ok).focus(), 20);
}

async function loadMobilMasuk() {
    try {
        const response = await fetch("/api/mobil-masuk", { cache: "no-store" });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
        mobilMasukData = Array.isArray(result.data) ? result.data : [];
        renderMobilMasuk();
    } catch (error) {
        console.error("Gagal mengambil Mobil Masuk:", error);
        mobilMasukData = [];
        renderMobilMasuk();
    }
}

function renderMobilMasuk() {
    const tbody = document.getElementById("mobilMasukTableBody");
    const search = String(document.getElementById("searchMobilMasuk")?.value || "").trim().toLowerCase();
    if (!tbody) return;

    const filtered = mobilMasukData.filter(item => {
        // Mobil yang sudah dipakai untuk Estimasi tidak boleh tampil lagi.
        if (item.used_at || item.used_estimate_id) return false;
        const text = [item.plate_number, item.brand, item.model, item.color].join(" ").toLowerCase();
        return !search || text.includes(search);
    });

    if (!filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7" class="mobil-masuk-empty">Belum ada Mobil Masuk.</td></tr>`;
        return;
    }

    tbody.innerHTML = filtered.map((item, index) => `
        <tr>
            <td>${index + 1}</td>
            <td><strong>${escapeMobilMasuk(item.plate_number)}</strong></td>
            <td>${escapeMobilMasuk(item.brand)}</td>
            <td>${escapeMobilMasuk(item.model)}</td>
            <td>${escapeMobilMasuk(item.color)}</td>
            <td>${escapeMobilMasuk(formatMobilMasukDate(item.created_at))}</td>
            <td><button type="button" class="btn-danger mobil-masuk-delete mw-delete-button" data-delete="${Number(item.id)}">Hapus</button></td>
        </tr>
    `).join("");
}

function openMobilMasukForm() {
    const modal = document.getElementById("mobilMasukModal");
    const form = document.getElementById("mobilMasukForm");
    const message = document.getElementById("mobilMasukMessage");
    if (form) form.reset();
    if (message) { message.textContent = ""; message.className = "mobil-masuk-message"; }
    if (modal) modal.classList.add("show");
    setTimeout(() => document.getElementById("mobilMasukPlate")?.focus(), 50);
}

function closeMobilMasukForm() {
    document.getElementById("mobilMasukModal")?.classList.remove("show");
}

async function submitMobilMasuk(event) {
    event.preventDefault();
    const message = document.getElementById("mobilMasukMessage");
    const payload = {
        plate_number: document.getElementById("mobilMasukPlate")?.value.trim() || "",
        brand: document.getElementById("mobilMasukBrand")?.value.trim() || "",
        model: document.getElementById("mobilMasukModel")?.value.trim() || "",
        color: document.getElementById("mobilMasukColor")?.value.trim() || ""
    };

    if (!payload.plate_number || !payload.brand || !payload.model || !payload.color) {
        if (message) { message.textContent = "No. Polisi, Merek, Type, dan Warna wajib diisi."; message.className = "mobil-masuk-message error"; }
        return;
    }

    try {
        const response = await fetch("/api/mobil-masuk", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        const result = await response.json().catch(() => ({}));
        if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
        closeMobilMasukForm();
        await loadMobilMasuk();
        showMobilMasukDialog(result.message || "Data Mobil Masuk berhasil disimpan.", { title: "Berhasil" });
    } catch (error) {
        if (message) { message.textContent = error.message || "Gagal menyimpan data Mobil Masuk."; message.className = "mobil-masuk-message error"; }
    }
}

async function hapusMobilMasuk(id) {
    const item = mobilMasukData.find(row => Number(row.id) === Number(id));
    if (!item) return;
    if (item.used_at || item.used_estimate_id) {
        showMobilMasukDialog("Mobil Masuk yang sudah digunakan untuk Estimasi tidak dapat dihapus.", { title: "Tidak Dapat Dihapus" });
        return;
    }

    showMobilMasukDialog(
        `Apakah Anda yakin ingin menghapus Mobil Masuk ${item.plate_number || ""}?`,
        {
            title: "Konfirmasi Hapus",
            confirm: true,
            onConfirm: async () => {
                try {
                    const response = await fetch(`/api/mobil-masuk/${Number(id)}`, { method: "DELETE" });
                    const result = await response.json().catch(() => ({}));
                    if (!response.ok || result?.success === false) throw new Error(result?.message || `HTTP ${response.status}`);
                    await loadMobilMasuk();
                    showMobilMasukDialog(result.message || "Data Mobil Masuk berhasil dihapus.", { title: "Berhasil" });
                } catch (error) {
                    console.error("Gagal menghapus Mobil Masuk:", error);
                    showMobilMasukDialog(error.message || "Gagal menghapus data Mobil Masuk.", { title: "Gagal" });
                }
            }
        }
    );
}

document.addEventListener("DOMContentLoaded", async () => {
    document.getElementById("btnTambahMobilMasuk")?.addEventListener("click", openMobilMasukForm);
    document.getElementById("btnCloseMobilMasuk")?.addEventListener("click", closeMobilMasukForm);
    document.getElementById("btnBatalMobilMasuk")?.addEventListener("click", closeMobilMasukForm);
    document.getElementById("mobilMasukForm")?.addEventListener("submit", submitMobilMasuk);
    document.getElementById("searchMobilMasuk")?.addEventListener("input", renderMobilMasuk);
    document.getElementById("mobilMasukTableBody")?.addEventListener("click", event => {
        const button = event.target.closest("[data-delete]");
        if (!button) return;
        hapusMobilMasuk(Number(button.dataset.delete));
    });
    document.getElementById("mobilMasukModal")?.addEventListener("click", event => {
        if (event.target.id === "mobilMasukModal") closeMobilMasukForm();
    });
    await loadMobilMasuk();
});
