// =========================================================
// MYWORKSHOP APP
// =========================================================



// =========================================================
// GLOBAL ALERT / ERROR MODAL
// Dipakai oleh seluruh halaman. Sebelumnya banyak halaman memanggil
// myWorkshopAlert(), tetapi fungsi global ini tidak tersedia sehingga
// error/validasi berhenti dengan ReferenceError dan tombol terlihat
// seperti tidak merespons.
// =========================================================
window.myWorkshopAlert = window.myWorkshopAlert || function(message, type = "error") {
    return new Promise(function(resolve) {
        const old = document.getElementById("mwGlobalAlertModal");
        if (old) old.remove();

        const modal = document.createElement("div");
        modal.id = "mwGlobalAlertModal";
        modal.style.cssText = "position:fixed;inset:0;z-index:100001;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,Helvetica,sans-serif;";

        const box = document.createElement("div");
        box.style.cssText = "width:min(460px,100%);background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:24px;box-sizing:border-box;";

        const isSuccess = String(type || "").toLowerCase() === "success";

        const icon = document.createElement("div");
        icon.style.cssText = `width:64px;height:64px;border-radius:50%;background:${isSuccess ? "#22c55e" : "#2563eb"};display:flex;align-items:center;justify-content:center;margin:0 auto 14px;box-shadow:0 6px 18px rgba(34,197,94,.25);${isSuccess ? "animation:mwSuccessPop .35s ease-out;" : ""}`;
        icon.innerHTML = isSuccess
            ? '<svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></svg>'
            : '<span style="color:#fff;font-size:28px;font-weight:800;line-height:1">i</span>';

        const title = document.createElement("div");
        title.textContent = isSuccess ? "Berhasil" : "Informasi";
        title.style.cssText = `font-size:18px;font-weight:700;color:${isSuccess ? "#15803d" : "#111827"};margin-bottom:10px;text-align:center;`;

        const body = document.createElement("div");
        body.textContent = String(message ?? "");
        body.style.cssText = "font-size:14px;color:#374151;line-height:1.55;white-space:pre-line;word-break:break-word;text-align:center;";

        const footer = document.createElement("div");
        footer.style.cssText = "display:flex;justify-content:flex-end;margin-top:20px;";

        const ok = document.createElement("button");
        ok.type = "button";
        ok.textContent = "OK";
        ok.style.cssText = "border:1px solid #2563eb;border-radius:7px;background:#2563eb;color:#fff;padding:9px 24px;font-weight:700;cursor:pointer;";

        const close = function() {
            if (!modal.isConnected) return;
            modal.remove();
            resolve(true);
        };

        modal.addEventListener("click", function(event) {
            if (!isSuccess && event.target === modal) close();
        });
        modal.addEventListener("keydown", function(event) {
            if (!isSuccess && (event.key === "Escape" || event.key === "Enter")) close();
        });

        box.insertBefore(icon, box.firstChild);
        box.appendChild(title);
        box.appendChild(body);
        if (!isSuccess) {
            footer.appendChild(ok);
            box.appendChild(footer);
        }
        if (isSuccess && !document.getElementById("mwSuccessPopStyle")) {
            const style = document.createElement("style");
            style.id = "mwSuccessPopStyle";
            style.textContent = "@keyframes mwSuccessPop{0%{transform:scale(.55);opacity:.2}70%{transform:scale(1.08);opacity:1}100%{transform:scale(1);opacity:1}}";
            document.head.appendChild(style);
        }
        modal.appendChild(box);
        document.body.appendChild(modal);
        if (!isSuccess) {
            ok.addEventListener("click", close);
            ok.focus();
        } else {
            // Modal sukses otomatis hilang; tidak membutuhkan tombol OKE.
            setTimeout(close, 1500);
        }
    });
};

// =========================================================
// LOGIN
// =========================================================

const userData =
    localStorage.getItem(
        "myworkshop_user"
    );


if (!userData) {

    window.location.href = "/";

}


// =========================================================
// ROLE ACCESS CONTROL
// =========================================================

const MYWORKSHOP_ROLE_ACCESS = {
    SUPER_ADMIN: {
        groups: ["dashboard", "master", "super-admin"]
    },
    MANAGER_MASTER: {
        groups: ["dashboard", "registrasi", "transaksi", "produksi", "sparepart", "billing", "laporan", "master"]
    },
    SERVICE_ADVISOR: {
        groups: ["registrasi", "transaksi", "produksi"]
    },
    SPAREPART_GUDANG: {
        groups: ["sparepart"]
    },
    BILLING: {
        groups: ["billing", "laporan"]
    }
};

const MYWORKSHOP_PAGE_GROUP = {
    customer: "registrasi",
    asuransi: "registrasi",
    "mobil-masuk": "registrasi",
    estimasi: "transaksi",
    "estimasi-selesai": "transaksi",
    wo: "produksi",
    "wo-selesai": "produksi",
    produksi: "produksi",
    stok: "sparepart",
    "permintaan-sparepart": "sparepart",
    "penerimaan-sparepart-supply": "sparepart",
    "sparepart-supply-belum-wo": "sparepart",
    "tagihan-or": "billing",
    "tagihan-kuitansi": "billing",
    "pemakaian-bahan": "billing",
    pembayaran: "billing",
    laporan: "laporan", users: "master"
};

function getLoggedInUser() {
    try {
        return JSON.parse(localStorage.getItem("myworkshop_user") || "null");
    } catch (error) {
        return null;
    }
}

function getRoleKey(currentUser = getLoggedInUser()) {
    const user = currentUser || {};
    const role = user.role;
    const roleCode = String(
        role?.code || role?.role_code || user.role_code || user.roleCode || ""
    ).trim().toUpperCase();
    const roleName = String(
        role?.name || role?.role_name || user.role_name || user.roleName ||
        (typeof role === "string" ? role : "") || ""
    ).trim().toUpperCase();

    if (roleCode === "SUPER_ADMIN" || roleName === "SUPER ADMIN") return "SUPER_ADMIN";
    if (roleCode === "MANAGER_MASTER" || roleName === "MANAGER MASTER") return "MANAGER_MASTER";
    if (roleCode === "SERVICE_ADVISOR" || roleName === "SERVICE ADVISOR") return "SERVICE_ADVISOR";
    if (roleCode === "SPAREPART_GUDANG" || roleName === "SPAREPART / GUDANG" || roleName === "SPAREPART GUDANG") return "SPAREPART_GUDANG";
    if (roleCode === "BILLING" || roleName === "BILLING") return "BILLING";
    return "";
}

function canAccessPage(page, currentUser = getLoggedInUser()) {
    const normalizedPage = String(page || "dashboard")
        .toLowerCase()
        .replace(/\.html$/, "");

    // Dashboard tetap menjadi halaman awal/login untuk semua role.
    if (normalizedPage === "dashboard") return true;

    // Manager Master adalah superuser: seluruh menu/halaman dapat diakses
    // tanpa pengecualian, termasuk Estimasi Selesai dan menu yang ditambahkan.
    const currentRoleKey = getRoleKey(currentUser);
    if (currentRoleKey === "MANAGER_MASTER" || currentRoleKey === "SUPER_ADMIN") return true;

    const group = MYWORKSHOP_PAGE_GROUP[normalizedPage];
    if (!group) return false;

    const roleKey = getRoleKey(currentUser);
    const access = MYWORKSHOP_ROLE_ACCESS[roleKey];

    return Boolean(access && access.groups.includes(group));
}

function getFirstAllowedPage(currentUser = getLoggedInUser()) {
    const roleKey = getRoleKey(currentUser);

    switch (roleKey) {
        case "SERVICE_ADVISOR":
            return "estimasi.html";
        case "SPAREPART_GUDANG":
            return "permintaan-sparepart.html";
        case "BILLING":
            return "tagihan-or.html";
        case "MANAGER_MASTER":
        case "SUPER_ADMIN":
            return "dashboard.html";
        default:
            return "dashboard.html";
    }
}

function normalizeMenuText(text) {
    return String(text || "")
        .replace(/[▸▼]/g, "")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
}

function getMenuGroupFromSection(section) {
    const explicit = String(section?.dataset?.menuGroup || "").trim().toLowerCase();
    if (explicit) return explicit;

    switch (normalizeMenuText(section?.textContent)) {
        case "REGISTRASI": return "registrasi";
        case "TRANSAKSI": return "transaksi";
        case "PRODUKSI": return "produksi";
        case "SPAREPART / GUDANG": return "sparepart";
        case "BILLING": return "billing";
        case "LAPORAN": return "laporan";
        default: return "";
    }
}

function ensureBillingMaterialMenu() {
    const menu = document.querySelector(".sidebar .menu");
    if (!menu) return;

    const billingSection = Array.from(menu.querySelectorAll(".menu-section")).find(section =>
        normalizeMenuText(section.textContent) === "BILLING"
    );
    if (!billingSection) return;

    const existing = menu.querySelector('.menu-item[data-page="pemakaian-bahan"]');
    if (existing) return;

    const kuitansi = menu.querySelector('.menu-item[data-page="tagihan-kuitansi"]');
    const item = document.createElement("a");
    item.href = "pemakaian-bahan.html";
    item.className = "menu-item";
    item.dataset.page = "pemakaian-bahan";
    item.innerHTML = '<span class="menu-icon">🧪</span><span>Input Pemakaian Bahan</span>';

    if (kuitansi) kuitansi.insertAdjacentElement("afterend", item);
    else billingSection.insertAdjacentElement("afterend", item);
}

function applyRoleMenuAccess() {
    const menu = document.querySelector(".sidebar .menu");
    if (!menu) return;

    ensureBillingMaterialMenu();

    const roleKey = getRoleKey();
    const access = MYWORKSHOP_ROLE_ACCESS[roleKey];
    const allowedGroups = access ? access.groups : [];

    menu.querySelectorAll(".menu-section[data-menu-group]").forEach(section => {
        const group = String(section.dataset.menuGroup || "").toLowerCase();
        const allowed = allowedGroups.includes(group);
        section.hidden = !allowed;
        section.style.setProperty("display", allowed ? "flex" : "none", "important");
        section.style.setProperty("pointer-events", allowed ? "auto" : "none", "important");

        const wrapper = section.nextElementSibling && section.nextElementSibling.classList.contains("main-menu-children")
            ? section.nextElementSibling : null;

        const items = wrapper
            ? Array.from(wrapper.querySelectorAll(":scope > .menu-item"))
            : (() => {
                const result = [];
                let node = section.nextElementSibling;
                while (node && !node.classList.contains("menu-section")) {
                    if (node.classList.contains("menu-item")) result.push(node);
                    node = node.nextElementSibling;
                }
                return result;
            })();

        items.forEach(item => {
            const page = String(item.dataset?.page || "").toLowerCase().replace(/\.html$/, "");
            const pageGroup = MYWORKSHOP_PAGE_GROUP[page];
            const itemAllowed = allowed && (page === "" || !pageGroup || allowedGroups.includes(pageGroup)) && canAccessPage(page);

            item.hidden = !itemAllowed;
            item.style.setProperty("display", itemAllowed ? "flex" : "none", "important");
            item.style.setProperty("pointer-events", itemAllowed ? "auto" : "none", "important");
        });

        if (!allowed && wrapper) {
            wrapper.hidden = true;
            wrapper.style.setProperty("display", "none", "important");
        }
    });

    const dashboardItem = menu.querySelector('.menu-item[data-page="dashboard"]');
    if (dashboardItem) {
        dashboardItem.hidden = false;
        dashboardItem.style.setProperty("display", "flex", "important");
        dashboardItem.style.setProperty("pointer-events", "auto", "important");
    }
}

function enforceCurrentPageAccess() {

    const currentPage = window.location.pathname
        .split("/")
        .pop()
        .toLowerCase()
        .replace(/\.html$/, "") || "dashboard";

    if (canAccessPage(currentPage)) {
        return true;
    }

    myWorkshopAlert("Anda tidak bisa mengakses menu ini.");

    const destination = getFirstAllowedPage();

    if (currentPage !== destination.replace(/\.html$/, "")) {
        window.location.replace("/" + destination);
    }

    return false;
}

// =========================================================
// USER
// =========================================================

let user = null;


try {

    user =
        JSON.parse(
            userData
        );

} catch (error) {

    localStorage.removeItem(
        "myworkshop_user"
    );

    window.location.href = "/";

}


// =========================================================
// USER INFO
// =========================================================

function loadUserInfo() {

    if (!user) {
        return;
    }


    const fullName =
        user.full_name ||
        user.name ||
        "User";


    const roleName =
        user.role?.name ||
        user.role ||
        "User";


    // -----------------------------------------------------
    // WELCOME
    // -----------------------------------------------------

    const welcomeName =
        document.getElementById(
            "welcomeName"
        );


    if (welcomeName) {

        welcomeName.textContent =
            fullName;

    }


    // -----------------------------------------------------
    // SIDEBAR
    // -----------------------------------------------------

    const sidebarUser =
        document.getElementById(
            "sidebarUser"
        );


    if (sidebarUser) {

        sidebarUser.textContent =
            fullName;

    }


    const sidebarName =
        document.getElementById(
            "sidebarName"
        );


    if (sidebarName) {

        sidebarName.textContent =
            fullName;

    }


    const sidebarRole =
        document.getElementById(
            "sidebarRole"
        );


    if (sidebarRole) {

        sidebarRole.textContent =
            roleName;

    }


    // -----------------------------------------------------
    // TOPBAR
    // -----------------------------------------------------

    const topName =
        document.getElementById(
            "topName"
        );


    if (topName) {

        topName.textContent =
            fullName;

    }


    const topRole =
        document.getElementById(
            "topRole"
        );


    if (topRole) {

        topRole.textContent =
            roleName;

    }


    // -----------------------------------------------------
    // INITIAL
    // -----------------------------------------------------

    const initials =
        fullName
            .trim()
            .split(/\s+/)
            .map(
                word =>
                    word.charAt(0)
            )
            .join("")
            .substring(0, 2)
            .toUpperCase();


    const topAvatar =
        document.getElementById(
            "topAvatar"
        );


    if (topAvatar) {

        topAvatar.textContent =
            initials;

    }


    const sidebarAvatar =
        document.getElementById(
            "sidebarAvatar"
        );


    if (sidebarAvatar) {

        sidebarAvatar.textContent =
            initials;

    }


    const userAvatar =
        document.querySelector(
            ".user-avatar"
        );


    if (userAvatar) {

        userAvatar.textContent =
            initials;

    }

}


// =========================================================
// DATE
// =========================================================

function loadCurrentDate() {

    const dateElement =
        document.getElementById(
            "currentDate"
        );


    if (!dateElement) {
        return;
    }


    const today =
        new Date();


    dateElement.textContent =
        today.toLocaleDateString(
            "id-ID",
            {
                weekday: "long",
                day: "numeric",
                month: "long",
                year: "numeric"
            }
        );

}


// =========================================================
// SIDEBAR TOGGLE
// =========================================================

function toggleSidebar() {

    const body =
        document.body;


    if (
        window.innerWidth <= 700
    ) {

        body.classList.toggle(
            "sidebar-open"
        );


    } else {

        body.classList.toggle(
            "sidebar-closed"
        );

    }

}


// =========================================================
// CLOSE MOBILE SIDEBAR
// =========================================================

document.addEventListener(
    "click",
    function (event) {

        const menuItem =
            event.target.closest(
                ".menu-item"
            );


        if (
            menuItem &&
            window.innerWidth <= 700
        ) {

            document.body.classList.remove(
                "sidebar-open"
            );

        }

    }
);


// =========================================================
// NAVIGATION
// =========================================================

function showPage(page) {

    if (!canAccessPage(page)) {
        myWorkshopAlert("Anda tidak bisa mengakses menu ini.");
        return;
    }

    switch (page) {

        case "dashboard":

            window.location.href =
                "/dashboard.html";

            break;


        case "customer":

            window.location.href =
                "/customer.html";

            break;


        case "kendaraan":

            window.location.href =
                "/kendaraan.html";

            break;


        case "estimasi":

            window.location.href =
                "/estimasi.html";

            break;


        case "wo":

            window.location.href =
                "/wo.html";

            break;


        case "wo-selesai":

            window.location.href =
                "/wo-selesai.html";

            break;


        case "stok":

            window.location.href =
                "/stok.html";

            break;


        case "permintaan":

            window.location.href =
                "/permintaan-sparepart.html";

            break;


        case "produksi":

            window.location.href =
                "/produksi.html";

            break;


        case "users":

            window.location.href =
                "/users.html";

            break;


        case "billing":

            window.location.href =
                "/billing.html";

            break;

        case "tagihan-or":

            window.location.href =
                "/tagihan-or.html";

            break;


        case "tagihan-kuitansi":

            window.location.href =
                "/tagihan-kuitansi.html";

            break;


        case "pemakaian-bahan":

            window.location.href =
                "/pemakaian-bahan.html";

            break;


        case "pembayaran":

            window.location.href =
                "/pembayaran.html";

            break;


        case "laporan":

            window.location.href =
                "/laporan.html";

            break;


        default:

            myWorkshopAlert(
                "Modul " +
                page +
                " belum tersedia."
            );

            break;

    }

}


// =========================================================
// ACTIVE MENU
// =========================================================

function setActiveMenu() {

    let currentPage =
        window.location.pathname
            .split("/")
            .pop()
            .toLowerCase();

    if (!currentPage) {
        currentPage = "dashboard.html";
    }

    currentPage = currentPage.replace(".html", "");

    document.querySelectorAll(".menu-item[data-page]").forEach(function (item) {

        const page = String(
            item.getAttribute("data-page") || ""
        ).toLowerCase();

        item.classList.toggle("active", page === currentPage);

    });

}


// =========================================================
// LOGOUT
// =========================================================

async function logout() {

    // myWorkshopConfirm tidak tersedia pada build ini. Gunakan modal konfirmasi
    // khusus Keluar agar tombol tidak berhenti karena ReferenceError.
    const confirmed = await new Promise(function (resolve) {
        const existing = document.getElementById("mwLogoutConfirmModal");
        if (existing) existing.remove();

        const modal = document.createElement("div");
        modal.id = "mwLogoutConfirmModal";
        modal.style.cssText = "position:fixed;inset:0;z-index:100000;background:rgba(15,23,42,.45);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,Helvetica,sans-serif;";
        modal.innerHTML = `
            <div style="width:min(420px,100%);background:#fff;border-radius:10px;box-shadow:0 20px 60px rgba(0,0,0,.25);padding:22px;box-sizing:border-box;">
                <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:8px;">Keluar Akun</div>
                <div style="font-size:14px;color:#4b5563;line-height:1.5;margin-bottom:20px;">Apakah Anda yakin ingin keluar?</div>
                <div style="display:flex;justify-content:flex-end;gap:8px;">
                    <button type="button" id="mwLogoutCancel" style="border:1px solid #d1d5db;background:#fff;color:#374151;border-radius:7px;padding:8px 14px;cursor:pointer;">Batal</button>
                    <button type="button" id="mwLogoutConfirm" style="border:0;background:#dc2626;color:#fff;border-radius:7px;padding:8px 14px;font-weight:600;cursor:pointer;">Keluar</button>
                </div>
            </div>`;
        document.body.appendChild(modal);

        const finish = function (value) {
            modal.remove();
            resolve(value);
        };
        document.getElementById("mwLogoutCancel")?.addEventListener("click", function () { finish(false); });
        document.getElementById("mwLogoutConfirm")?.addEventListener("click", function () { finish(true); });
        modal.addEventListener("click", function (event) {
            if (event.target === modal) finish(false);
        });
    });

    if (!confirmed) return;

    try {
        await fetch("/api/logout", {
            method: "POST",
            credentials: "same-origin",
            headers: { "Content-Type": "application/json" },
            cache: "no-store"
        });
    } catch (error) {
        console.warn("LOGOUT SERVER ERROR:", error);
    } finally {
        localStorage.removeItem("myworkshop_user");
        window.location.replace("/");
    }
}


// =========================================================
// AUTO UPPERCASE INPUT
// =========================================================
// Semua input teks transaksi/master otomatis menjadi huruf kapital
// saat pengguna berpindah kolom. Field sensitif/berformat khusus
// seperti email, password, pencarian, URL, dan file tidak diubah.
function normalizeTextInputToUppercase(element) {
    if (!element || !(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) {
        return;
    }

    if (element instanceof HTMLTextAreaElement) {
        element.value = String(element.value || "").toUpperCase();
        return;
    }

    const type = String(element.type || "text").toLowerCase();
    const excludedTypes = new Set([
        "email",
        "password",
        "search",
        "url",
        "file",
        "number",
        "date",
        "datetime-local",
        "month",
        "time",
        "week",
        "color",
        "range",
        "hidden",
        "checkbox",
        "radio",
        "button",
        "submit",
        "reset"
    ]);

    if (excludedTypes.has(type)) return;

    element.value = String(element.value || "").toUpperCase();
}

// Delegation dipakai agar input yang dibuat dinamis (misalnya
// baris Sparepart/Jasa) juga otomatis mengikuti aturan yang sama.
document.addEventListener(
    "blur",
    event => {
        normalizeTextInputToUppercase(event.target);
    },
    true
);

// =========================================================
// START
// =========================================================

function initApp() {

    if (!enforceCurrentPageAccess()) {
        return;
    }

    loadUserInfo();

    loadCurrentDate();

    applyRoleMenuAccess();

    setActiveMenu();

}


// ---------------------------------------------------------
// Karena app.js dapat dimuat secara dinamis oleh layout.js,
// jalankan langsung jika DOM sudah siap.
// ---------------------------------------------------------

if (
    document.readyState ===
    "loading"
) {

    document.addEventListener(
        "DOMContentLoaded",
        initApp
    );

} else {

    initApp();

}
// ============================================================
// MYWORKSHOP - CENTRAL STORAGE HELPER
// Semua data transaksi/pendukung modul harus disimpan melalui
// database pusat. localStorage hanya untuk session/UI preference.
// ============================================================
window.myWorkshopCentralStorage = {
    async get(key, fallback = null) {
        const r = await fetch(`/api/storage/${encodeURIComponent(key)}`, { cache: "no-store" });
        const j = await r.json();
        if (!r.ok || j?.success === false) throw new Error(j?.message || `HTTP ${r.status}`);
        return j?.data ?? fallback;
    },
    async set(key, data, userId = null) {
        const r = await fetch(`/api/storage/${encodeURIComponent(key)}`, {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ data, updated_by: Number(userId || 0) || null })
        });
        const j = await r.json();
        if (!r.ok || j?.success === false) throw new Error(j?.message || `HTTP ${r.status}`);
        return j?.data;
    },
    async remove(key) {
        const r = await fetch(`/api/storage/${encodeURIComponent(key)}`, { method: "DELETE" });
        const j = await r.json();
        if (!r.ok || j?.success === false) throw new Error(j?.message || `HTTP ${r.status}`);
        return true;
    }
};
