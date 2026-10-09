// =========================================================
// MYWORKSHOP LAYOUT + MAIN MENU
// =========================================================

(function () {
    "use strict";

    const MAIN_MENU_NAMES = [
        "REGISTRASI",
        "TRANSAKSI",
        "PRODUKSI",
        "SPAREPART / GUDANG",
        "BILLING",
        "LAPORAN"
    ];

    function normalize(text) {
        return String(text || "")
            .replace(/[▸▼]/g, "")
            .replace(/\s+/g, " ")
            .trim()
            .toUpperCase();
    }

    function ensureSidebarCountStyle() {
        if (document.getElementById("mwSidebarCountStyle")) return;
        const style = document.createElement("style");
        style.id = "mwSidebarCountStyle";
        style.textContent = `
            .sidebar .menu-item {
                transition: transform 160ms ease, box-shadow 160ms ease;
                transform-origin: left center;
            }
            .sidebar .menu-item:hover {
                transform: scale(1.035);
                position: relative;
                z-index: 2;
            }
            .sidebar .menu-item .sidebar-count {
                display: inline-flex;
                align-items: center;
                justify-content: center;
                min-width: 20px;
                height: 20px;
                padding: 0 6px;
                margin-left: auto;
                border-radius: 999px;
                box-sizing: border-box;
                background: #dc2626;
                color: #fff;
                font-size: 11px;
                font-weight: 800;
                line-height: 20px;
                flex: 0 0 auto;
            }
        `;
        document.head.appendChild(style);
    }

    function setSidebarCount(page, value) {
        const node = document.querySelector(`.sidebar-count[data-sidebar-count="${page}"]`);
        if (!node) return;
        const count = Math.max(0, Number(value) || 0);
        node.textContent = String(count);
        node.title = `${count} dokumen belum terselesaikan`;
        node.style.display = count > 0 ? "inline-flex" : "none";
        node.setAttribute("aria-hidden", count > 0 ? "false" : "true");
    }

    function sidebarSupplyParts(wo) {
        const parts = wo?.spareparts || wo?.sparepart || wo?.items_sparepart || [];
        return Array.isArray(parts) ? parts : [];
    }

    function sidebarSupplyType(item) {
        return String(item?.supply_bengkel ?? item?.supplyBengkel ?? item?.supply ?? "BENGKEL").trim().toUpperCase();
    }

    function sidebarIsReturned(record) {
        const history = Array.isArray(record?.return_history) ? record.return_history : [];
        const latest = history.length ? history[history.length - 1] : null;
        return !!(record?.returned || record?.return_status === "RETURN" || record?.status === "RETURN" || latest?.returned || latest?.status === "RETURN");
    }

    function sidebarSupplyArrived(arrivals, woId, index, itemId) {
        const sameWO = x => String(x?.wo_id ?? x?.woId ?? "") === String(woId);
        if (itemId !== null && itemId !== undefined && String(itemId) !== "") {
            const byId = arrivals.find(x => sameWO(x) && String(x?.item_id ?? x?.itemId ?? "") === String(itemId));
            if (byId && !sidebarIsReturned(byId)) return true;
        }
        const byIndex = arrivals.find(x => sameWO(x) && Number(x?.item_index ?? x?.itemIndex) === Number(index));
        return !!(byIndex && !sidebarIsReturned(byIndex));
    }

    function sidebarBengkelPending(workRows) {
        return workRows.filter(wo => String(wo?.status || "").trim().toUpperCase() !== "CHECK OUT")
            .filter(wo => sidebarSupplyParts(wo).some(item => sidebarSupplyType(item) !== "SUPPLY"))
            .length;
    }

    function sidebarSupplyPending(workRows, arrivals, kuitansiRows) {
        const kuitansiWO = new Set((Array.isArray(kuitansiRows) ? kuitansiRows : []).map(x => String(x?.wo_id ?? x?.woId ?? "")));
        return workRows.filter(wo => {
            if (String(wo?.status || "").trim().toUpperCase() === "CHECK OUT") return false;
            const parts = sidebarSupplyParts(wo).filter(item => sidebarSupplyType(item) === "SUPPLY");
            if (!parts.length) return false;
            const remaining = parts.filter((item, index) => !sidebarSupplyArrived(arrivals, wo?.id ?? wo?.wo_id, index, item?.id)).length;
            if (remaining > 0) return true;
            return !kuitansiWO.has(String(wo?.id ?? wo?.wo_id ?? ""));
        }).length;
    }

    async function refreshSidebarCounts() {
        const definitions = {
            "mobil-masuk": "/api/mobil-masuk",
            "estimasi": "/api/estimasi",
            "wo": "/api/wo",
            "permintaan-sparepart": "/api/sparepart/work-data",
            "penerimaan-sparepart-supply": "/api/sparepart/work-data",
            "tagihan-or": "/api/tagihan-or",
            "tagihan-kuitansi": "/api/tagihan-kuitansi",
            "pembayaran": "/api/pembayaran"
        };
        const pages = Object.keys(definitions).filter(page => {
            const node = document.querySelector(`.menu-item[data-page="${page}"]`);
            return node && canAccessPage(page);
        });
        if (!pages.length) return;

        try {
            const uniqueUrls = [...new Set(pages.map(page => definitions[page]))];
            const responses = await Promise.all(uniqueUrls.map(url => fetch(url, { cache: "no-store", credentials: "same-origin" })));
            if (responses.some(r => r.status === 401)) return;
            const jsonByUrl = new Map();
            for (let i = 0; i < uniqueUrls.length; i++) {
                jsonByUrl.set(uniqueUrls[i], await responses[i].json().catch(() => ({})));
            }

            const mobil = jsonByUrl.get("/api/mobil-masuk")?.data;
            const estimasi = jsonByUrl.get("/api/estimasi")?.data;
            const wo = jsonByUrl.get("/api/wo")?.data;
            const work = jsonByUrl.get("/api/sparepart/work-data") || {};
            const workRows = Array.isArray(work.data) ? work.data : [];
            const arrivals = Array.isArray(work.supply_arrivals) ? work.supply_arrivals : [];
            const kuitansiFromWork = Array.isArray(work.kuitansi) ? work.kuitansi : [];
            const orRows = jsonByUrl.get("/api/tagihan-or")?.data;
            const kuitansi = jsonByUrl.get("/api/tagihan-kuitansi")?.data;
            const pembayaran = jsonByUrl.get("/api/pembayaran")?.data;

            if (pages.includes("mobil-masuk")) setSidebarCount("mobil-masuk", Array.isArray(mobil) ? mobil.length : 0);
            if (pages.includes("estimasi")) setSidebarCount("estimasi", Array.isArray(estimasi) ? estimasi.length : 0);
            if (pages.includes("wo")) setSidebarCount("wo", Array.isArray(wo) ? wo.filter(row => String(row?.status || "").trim().toUpperCase() !== "CHECK OUT").length : 0);
            if (pages.includes("permintaan-sparepart")) setSidebarCount("permintaan-sparepart", sidebarBengkelPending(workRows));
            if (pages.includes("penerimaan-sparepart-supply")) setSidebarCount("penerimaan-sparepart-supply", sidebarSupplyPending(workRows, arrivals, kuitansiFromWork));
            if (pages.includes("tagihan-or")) setSidebarCount("tagihan-or", Array.isArray(orRows) ? orRows.filter(row => Number(row?.remaining_amount ?? 0) > 0).length : 0);
            if (pages.includes("tagihan-kuitansi")) setSidebarCount("tagihan-kuitansi", Array.isArray(kuitansi) ? kuitansi.filter(row => !row?.kuitansi_id && !row?.id).length : 0);
            if (pages.includes("pembayaran")) setSidebarCount("pembayaran", Array.isArray(pembayaran) ? pembayaran.filter(row => !row?.payment_id).length : 0);
        } catch (error) {
            console.warn("Gagal memperbarui angka sidebar:", error);
        }
    }

    function getChildren(section) {
        const result = [];
        let node = section.nextElementSibling;

        while (node && !node.classList.contains("menu-section")) {
            if (node.classList.contains("menu-item")) result.push(node);
            node = node.nextElementSibling;
        }
        return result;
    }

    function closeSection(section) {
        section.setAttribute("aria-expanded", "false");
        const wrapper = section.nextElementSibling && section.nextElementSibling.classList.contains("main-menu-children")
            ? section.nextElementSibling : null;
        if (wrapper) {
            wrapper.hidden = true;
            wrapper.style.setProperty("display", "none", "important");
            return;
        }
        getChildren(section).forEach(function (item) { item.hidden = true; });
    }

    function openSection(section) {
        const group = getMenuGroupFromSection(section);
        if (!getAllowedGroups().includes(group)) {
            showAccessWarning();
            return;
        }
        section.setAttribute("aria-expanded", "true");
        const wrapper = section.nextElementSibling && section.nextElementSibling.classList.contains("main-menu-children")
            ? section.nextElementSibling : null;
        if (wrapper) {
            wrapper.hidden = false;
            wrapper.style.setProperty("display", "block", "important");
            return;
        }
        getChildren(section).forEach(function (item) { item.hidden = false; });
    }

    // Hak akses MENU bersifat eksplisit per halaman.
    // Jangan hanya mengandalkan group, karena menu tambahan seperti
    // Estimasi Selesai / WO Selesai harus tetap tersembunyi dari role lain.
    const ROLE_PAGES = {
        SUPER_ADMIN: [
            "super-admin-dashboard", "super-admin", "super-admin-workshop-edit", "users", "super-admin-settings", "super-admin-monitoring", "audit-log", "profile"
        ],
        MANAGER_MASTER: [
            "dashboard", "customer", "asuransi", "mobil-masuk", "estimasi", "estimasi-selesai",
            "wo", "wo-selesai", "produksi", "stok", "permintaan-sparepart",
            "penerimaan-sparepart-supply", "sparepart-supply-belum-wo", "tagihan-or", "tagihan-kuitansi", "pemakaian-bahan",
            "pembayaran", "laporan", "users"
        ],
        SERVICE_ADVISOR: [
            "dashboard", "customer", "asuransi", "mobil-masuk", "estimasi", "estimasi-selesai",
            "wo", "wo-selesai", "produksi"
        ],
        SPAREPART_GUDANG: [
            "dashboard", "stok", "permintaan-sparepart", "penerimaan-sparepart-supply", "sparepart-supply-belum-wo"
        ],
        BILLING: [
            "dashboard", "tagihan-or", "tagihan-kuitansi", "pemakaian-bahan", "pembayaran", "laporan"
        ]
    };

    const PAGE_GROUPS = {
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
        laporan: "laporan",
        users: "master",
        "super-admin": "super-admin",
        "super-admin-dashboard": "super-admin",
        "super-admin-settings": "super-admin",
        "super-admin-monitoring": "super-admin",
        "audit-log": "super-admin",
        profile: "super-admin"
    };

    function getLoggedInUser() {
        try {
            return JSON.parse(localStorage.getItem("myworkshop_user") || "null");
        } catch (error) {
            return null;
        }
    }

    function getRoleKey() {
        const user = getLoggedInUser() || {};
        const role = user.role;

        const code = String(
            role?.code ||
            role?.role_code ||
            user.role_code ||
            user.roleCode ||
            ""
        ).trim().toUpperCase();

        const name = String(
            role?.name ||
            role?.role_name ||
            user.role_name ||
            user.roleName ||
            (typeof role === "string" ? role : "") ||
            ""
        ).trim().toUpperCase();

        if (code === "SUPER_ADMIN" || name === "SUPER ADMIN") return "SUPER_ADMIN";
        if (code === "MANAGER_MASTER" || name === "MANAGER MASTER") return "MANAGER_MASTER";
        if (code === "SERVICE_ADVISOR" || name === "SERVICE ADVISOR") return "SERVICE_ADVISOR";
        if (code === "SPAREPART_GUDANG" || name === "SPAREPART / GUDANG" || name === "SPAREPART GUDANG") return "SPAREPART_GUDANG";
        if (code === "BILLING" || name === "BILLING") return "BILLING";
        return "";
    }

    function getAllowedGroups() {
        const pages = ROLE_PAGES[getRoleKey()] || [];
        const groups = new Set();
        pages.forEach(function (page) {
            if (PAGE_GROUPS[page]) groups.add(PAGE_GROUPS[page]);
        });
        return Array.from(groups);
    }

    function getAllowedPages() {
        return ROLE_PAGES[getRoleKey()] || [];
    }

    function isAllowedPage(page) {
        return getAllowedPages().includes(String(page || "").toLowerCase());
    }

    // Dipakai oleh handler klik menu. Pertahankan satu sumber aturan akses
    // agar link langsung dan klik submenu menggunakan aturan yang sama.
    function canAccessPage(page) {
        return isAllowedPage(page);
    }

    function ensureRoleControlledMenus() {
        const menu = document.querySelector(".sidebar .menu");
        if (!menu) return;

        if (getRoleKey() === "SUPER_ADMIN") {
            // SUPER ADMIN memiliki sidebar tersendiri.
            // Semua menu adalah menu utama langsung, tanpa submenu/grup.
            // Hapus seluruh struktur menu bawaan bengkel agar tidak muncul
            // Dashboard/USER & ROLE ganda.
            menu.innerHTML = "";

            const items = [
                ["super-admin-dashboard", "super-admin-dashboard.html", "🏠", "Dashboard"],
                ["super-admin", "super-admin.html", "🏢", "Data Bengkel"],
                ["users", "users.html", "👥", "User & Akses"],
                ["super-admin-settings", "super-admin-settings.html", "⚙️", "Pengaturan Sistem"],
                ["super-admin-monitoring", "super-admin-monitoring.html", "📊", "Monitoring"],
                ["audit-log", "audit-log.html", "📝", "Audit Log"],
                ["profile", "profile.html", "👤", "Profil"]
            ];

            items.forEach(function (itemData) {
                const a = document.createElement("a");
                a.href = itemData[1];
                a.className = "menu-item menu-super-admin";
                a.dataset.page = itemData[0];
                a.innerHTML = '<span class="menu-icon">' + itemData[2] + '</span><span>' + itemData[3] + '</span>';
                menu.appendChild(a);
            });

            // Tidak ada menu section / submenu pada sidebar Super Admin.
            menu.querySelectorAll(".menu-section, .main-menu-children").forEach(function (node) {
                node.remove();
            });

            const logoutButton = menu.closest(".sidebar")?.querySelector(".logout-button");
            if (logoutButton) logoutButton.textContent = "🚪  Logout";
            return;
        }

        const estimasi = menu.querySelector('.menu-item[data-page="estimasi"]');
        if (estimasi && !menu.querySelector('.menu-item[data-page="estimasi-selesai"]')) {
            const a = document.createElement("a");
            a.href = "estimasi-selesai.html";
            a.className = "menu-item";
            a.dataset.page = "estimasi-selesai";
            a.innerHTML = '<span class="menu-icon">✅</span><span>Estimasi Selesai</span>';
            estimasi.insertAdjacentElement("afterend", a);
        }

        const woSelesai = menu.querySelector('.menu-item[data-page="wo-selesai"]');
        if (woSelesai && !menu.querySelector('.menu-item[data-page="produksi"]')) {
            const a = document.createElement("a");
            a.href = "produksi.html";
            a.className = "menu-item";
            a.dataset.page = "produksi";
            a.innerHTML = '<span class="menu-icon">🔧</span><span>Vendor Produksi</span>';
            woSelesai.insertAdjacentElement("afterend", a);
        }

        const tagihanKuitansi = menu.querySelector('.menu-item[data-page="tagihan-kuitansi"]');
        if (tagihanKuitansi && !menu.querySelector('.menu-item[data-page="pemakaian-bahan"]')) {
            const a = document.createElement("a");
            a.href = "pemakaian-bahan.html";
            a.className = "menu-item";
            a.dataset.page = "pemakaian-bahan";
            a.innerHTML = '<span class="menu-icon">🧪</span><span>Input Pemakaian Bahan</span>';
            tagihanKuitansi.insertAdjacentElement("afterend", a);
        }
    }

    function applyRoleAccess() {
        ensureRoleControlledMenus();
        const menu = document.querySelector(".sidebar .menu");
        if (!menu) return;

        const allowedGroups = getAllowedGroups();
        const sections = Array.from(menu.querySelectorAll(":scope > .menu-section"));

        sections.forEach(function (section) {
            const group = getMenuGroupFromSection(section);
            if (!group) return;

            const allowed = allowedGroups.includes(group);
            const wrapper = section.nextElementSibling && section.nextElementSibling.classList.contains("main-menu-children")
                ? section.nextElementSibling
                : null;

            section.hidden = !allowed;
            section.style.setProperty("display", allowed ? "flex" : "none", "important");
            section.style.setProperty("pointer-events", allowed ? "auto" : "none", "important");
            section.setAttribute("aria-hidden", allowed ? "false" : "true");
            section.setAttribute("aria-expanded", allowed ? (section.getAttribute("aria-expanded") || "false") : "false");

            if (wrapper) {
                // Hak akses dan status buka/tutup submenu adalah dua hal berbeda.
                // Jangan menggunakan wrapper.hidden untuk menyembunyikan item yang
                // sebenarnya berhak diakses. Saat pindah halaman, setupMainMenus()
                // membuka kelompok halaman aktif; applyRoleAccess() hanya boleh
                // memfilter item berdasarkan role.
                if (!allowed) {
                    wrapper.hidden = true;
                    wrapper.style.setProperty("display", "none", "important");
                    wrapper.style.setProperty("pointer-events", "none", "important");
                } else {
                    wrapper.style.setProperty("pointer-events", "auto", "important");
                    // Jangan mengubah wrapper.hidden di sini. Biarkan state accordion
                    // yang ditentukan oleh setupMainMenus()/openSection()/closeSection().
                    wrapper.style.setProperty("display", wrapper.hidden ? "none" : "block", "important");
                }

                wrapper.querySelectorAll(".menu-item").forEach(function(item) {
                    const page = String(item.dataset.page || "").toLowerCase().replace(/\.html$/, "");
                    const itemAllowed = allowed && isAllowedPage(page);
                    // hidden adalah state accordion, bukan role access.
                    // Jangan mengubahnya di sini agar membuka satu submenu tidak
                    // membuat item lain kehilangan state saat navigasi.
                    item.classList.toggle("mw-layout-role-hidden", !itemAllowed);
                    item.style.setProperty("display", itemAllowed ? "flex" : "none", "important");
                    item.style.setProperty("pointer-events", itemAllowed ? "auto" : "none", "important");
                    item.setAttribute("aria-hidden", itemAllowed ? "false" : "true");
                });
            } else {
                let node = section.nextElementSibling;
                while (node && !node.classList.contains("menu-section")) {
                    node.hidden = !allowed;
                    node.style.setProperty("display", allowed ? "" : "none", "important");
                    node.style.setProperty("pointer-events", allowed ? "auto" : "none", "important");
                    node = node.nextElementSibling;
                }
            }
        });

        if (getRoleKey() !== "SUPER_ADMIN") {
            const dashboard = menu.querySelector('.menu-item[data-page="dashboard"]');
            if (dashboard) {
                dashboard.hidden = false;
                dashboard.style.setProperty("display", "flex", "important");
                dashboard.style.setProperty("pointer-events", "auto", "important");
            }
        }
    }

    function canAccessCurrentPage() {
        const page = getCurrentPage();
        return isAllowedPage(page);
    }

    function showAccessWarning() {
        myWorkshopAlert("Anda tidak bisa mengakses menu ini.");
    }

    function enforcePageAccess() {
        if (canAccessCurrentPage()) return true;

        showAccessWarning();

        const allowed = getAllowedGroups();
        let destination = "dashboard.html";
        const roleKey = getRoleKey();

        if (roleKey === "SUPER_ADMIN") destination = "super-admin-dashboard.html";
        else if (allowed.includes("transaksi")) destination = "estimasi.html";
        else if (allowed.includes("produksi")) destination = "wo.html";
        else if (allowed.includes("sparepart")) destination = "permintaan-sparepart.html";
        else if (allowed.includes("billing")) destination = "tagihan-or.html";
        else if (allowed.includes("laporan")) destination = "dashboard.html";

        window.location.replace("/" + destination);
        return false;
    }

    function getMenuGroupFromSection(section) {
        const explicit = String(section?.dataset?.menuGroup || "").trim().toLowerCase();
        if (explicit) return explicit;

        switch (normalize(section?.textContent)) {
            case "REGISTRASI": return "registrasi";
            case "TRANSAKSI": return "transaksi";
            case "PRODUKSI": return "produksi";
            case "SPAREPART / GUDANG": return "sparepart";
            case "BILLING": return "billing";
            case "LAPORAN": return "laporan";
            case "SUPER ADMIN": return "super-admin";
            case "DATA BENGKEL": return "super-admin";
            case "USER & AKSES": return "super-admin";
            case "PENGATURAN SISTEM": return "super-admin";
            case "MONITORING": return "super-admin";
            case "AKUN": return "super-admin";
            case "USER & ROLE": return "master";
            case "UTAMA": return "dashboard";
            default: return "";
        }
    }

    function setupMainMenus() {
        const menu = document.querySelector(".sidebar .menu");
        if (!menu) return;

        // Pastikan CSS tersedia walaupun style.css belum memiliki aturan submenu.
        if (!document.getElementById("myworkshop-main-menu-runtime-style")) {
            const style = document.createElement("style");
            style.id = "myworkshop-main-menu-runtime-style";
            style.textContent = `
                .sidebar .menu-section.main-menu-toggle {
                    cursor: pointer !important;
                    user-select: none;
                    display: flex !important;
                    align-items: center;
                    justify-content: space-between;
                }
                .sidebar .main-menu-arrow {
                    display: inline-block;
                    transition: transform .15s ease;
                    pointer-events: none;
                }
                .sidebar .main-menu-toggle[aria-expanded="true"] .main-menu-arrow {
                    transform: rotate(90deg);
                }
                .sidebar .main-menu-children {
                    display: block;
                }
                .sidebar .main-menu-children[hidden] {
                    display: none !important;
                }
            `;
            document.head.appendChild(style);
        }

        // Tandai menu utama dan normalisasi struktur submenu yang sudah ada.
        Array.from(menu.querySelectorAll(":scope > .menu-section")).forEach(function (section) {
            const name = normalize(section.textContent);
            if (!MAIN_MENU_NAMES.includes(name)) return;

            section.classList.add("main-menu-toggle");
            section.dataset.mainMenuReady = "1";
            section.setAttribute("role", "button");
            section.setAttribute("tabindex", "0");
            section.setAttribute("aria-expanded", "false");

            let children = getChildren(section);
            let wrapper = section.nextElementSibling;

            // Jika sidebar memiliki wrapper submenu, gunakan wrapper tersebut.
            if (wrapper && wrapper.classList.contains("main-menu-children")) {
                wrapper.dataset.parentGroup = section.dataset.menuGroup || name.toLowerCase();
                children = Array.from(wrapper.querySelectorAll(":scope > .menu-item"));
            } else if (children.length) {
                wrapper = document.createElement("div");
                wrapper.className = "main-menu-children";
                wrapper.dataset.parentGroup = section.dataset.menuGroup || name.toLowerCase();
                children.forEach(function (item) {
                    wrapper.appendChild(item);
                });
                section.after(wrapper);
            }

            if (!section.querySelector(".main-menu-arrow")) {
                const arrow = document.createElement("span");
                arrow.className = "main-menu-arrow";
                arrow.textContent = "▸";
                section.appendChild(arrow);
            }

            // Tutup hanya submenu; Dashboard tetap terlihat.
            if (wrapper) {
                wrapper.hidden = true;
            } else {
                children.forEach(function (item) { item.hidden = true; });
            }
        });

        if (menu.dataset.mainMenuDelegated === "1") return;
        menu.dataset.mainMenuDelegated = "1";

        // Cegah klik langsung ke submenu yang tidak menjadi hak role.
        // Ini juga melindungi link yang memakai href langsung, bukan showPage().
        menu.addEventListener("click", function (event) {
            const item = event.target.closest(".menu-item[data-page]");
            if (!item || !menu.contains(item)) return;

            const page = String(item.getAttribute("data-page") || "")
                .toLowerCase().replace(/\.html$/, "");

            if (!canAccessPage(page)) {
                event.preventDefault();
                event.stopPropagation();
                event.stopImmediatePropagation();
                showAccessWarning();
            }
        }, true);

        // Event delegation di level MENU. Ini sengaja menggunakan capture agar
        // handler lama dari app.js/sidebar.html tidak dapat menggagalkan klik.
        menu.addEventListener("click", function (event) {
            const section = event.target.closest(".menu-section.main-menu-toggle");
            if (!section || !menu.contains(section)) return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();

            // A forbidden main group must never open. Normally it is hidden by
            // applyRoleAccess(), but this guard also covers stale/cached DOM.
            const group = getMenuGroupFromSection(section);
            if (!getAllowedGroups().includes(group)) {
                showAccessWarning();
                return;
            }

            const wasOpen = section.getAttribute("aria-expanded") === "true";

            Array.from(menu.querySelectorAll(".menu-section.main-menu-toggle")).forEach(function (other) {
                if (other !== section) closeSection(other);
            });

            if (wasOpen) closeSection(section);
            else openSection(section);
        }, true);

        menu.addEventListener("keydown", function (event) {
            const section = event.target.closest(".menu-section.main-menu-toggle");
            if (!section || !menu.contains(section)) return;
            if (event.key !== "Enter" && event.key !== " ") return;

            event.preventDefault();
            event.stopPropagation();
            event.stopImmediatePropagation();
            section.click();
        }, true);

        // Buka kelompok yang berisi halaman aktif.
        const currentPage = getCurrentPage();
        const active = menu.querySelector('.menu-item[data-page="' + CSS.escape(currentPage) + '"]');
        if (active) {
            let parent = active.closest(".main-menu-children");
            if (parent) {
                const section = parent.previousElementSibling;
                if (section && section.classList.contains("main-menu-toggle")) {
                    openSection(section);
                }
            }
        }
    }

    function getCurrentPage() {
        let page = window.location.pathname.split("/").pop().toLowerCase();
        if (!page) page = "dashboard.html";
        return page.replace(/\.html$/, "");
    }

    function setActiveMenu() {
        const currentPage = getCurrentPage();
        document.querySelectorAll(".menu-item[data-page]").forEach(function (item) {
            const page = String(item.getAttribute("data-page") || "").toLowerCase();
            item.classList.toggle("active", page === currentPage);
        });
    }


    let menuRoleObserverStarted = false;

    function startRoleObserver() {
        if (menuRoleObserverStarted) return;
        const menu = document.querySelector(".sidebar .menu");
        if (!menu) return;
        menuRoleObserverStarted = true;
        const observer = new MutationObserver(function () {
            applyRoleAccess();
        });
        observer.observe(menu, { childList: true, subtree: true });
    }

    async function ensureImpersonationBanner() {
        try {
            const response = await fetch("/api/session", { cache: "no-store" });
            const json = await response.json().catch(() => ({}));
            if (!response.ok || !json.success) return;
            const user = json.user || {};
            if (!user.acting_as) return;
            localStorage.setItem("myworkshop_user", JSON.stringify(user));
            let banner = document.getElementById("mw-impersonation-banner");
            if (!banner) {
                banner = document.createElement("div");
                banner.id = "mw-impersonation-banner";
                banner.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#b91c1c;color:#fff;padding:9px 14px;display:flex;align-items:center;justify-content:center;gap:14px;font:700 13px Arial,Helvetica,sans-serif;box-shadow:0 2px 8px rgba(0,0,0,.18);";
                document.body.prepend(banner);
            }
            const name = String(user.workshop_name || "Bengkel");
            banner.innerHTML = `<span>⚠️ MODE SUPER ADMIN — Anda sedang bertindak sebagai bengkel: <strong>${workshopPrintEsc(name)}</strong></span><button type="button" id="mw-return-super-admin" style="border:1px solid rgba(255,255,255,.8);background:#fff;color:#991b1b;border-radius:6px;padding:6px 10px;font-weight:700;cursor:pointer">↩ Kembali ke Super Admin</button>`;
            document.getElementById("mw-return-super-admin").onclick = async function(){
                this.disabled=true;
                try {
                    const r=await fetch("/api/super-admin/return",{method:"POST",headers:{"Content-Type":"application/json"}});
                    const d=await r.json().catch(()=>({}));
                    if(!r.ok||!d.success) throw new Error(d.message||"Gagal kembali ke Super Admin.");
                    localStorage.setItem("myworkshop_user",JSON.stringify(d.user));
                    window.location.href="/super-admin.html";
                } catch(e) { this.disabled=false; myWorkshopAlert(e.message); }
            };
            document.body.style.paddingTop="44px";
        } catch (_) {}
    }

    async function loadSidebar() {
        const sidebarContainer = document.getElementById("sidebar-container");

        if (!sidebarContainer) {
            await ensureImpersonationBanner();
            setActiveMenu();
            return;
        }

        try {
            const response = await fetch("/sidebar.html", { cache: "no-cache" });
            if (!response.ok) throw new Error("sidebar.html tidak ditemukan.");

            sidebarContainer.innerHTML = await response.text();
            ensureSidebarCountStyle();

            // PENTING: script di sidebar.html yang dimasukkan lewat innerHTML
            // tidak dijalankan. Karena itu seluruh inisialisasi dilakukan di sini.
            await ensureImpersonationBanner();
            setupMainMenus();
            applyRoleAccess();
            if (!enforcePageAccess()) return;
            setActiveMenu();
            refreshSidebarCounts();
            if (!window.__mwSidebarCountTimer) {
                window.__mwSidebarCountTimer = window.setInterval(refreshSidebarCounts, 30000);
            }

            // Pastikan perubahan DOM dari halaman lain tidak pernah mengembalikan
            // menu yang bukan hak role.
            if (!menuRoleObserverStarted) startRoleObserver();

            // app.js dimuat setelah sidebar siap.
            if (!document.querySelector('script[data-myworkshop-app]')) {
                const script = document.createElement("script");
                script.src = "/app.js";
                script.dataset.myworkshopApp = "true";
                document.body.appendChild(script);
            }

            // Fallback handler: tombol Keluar tidak bergantung pada handler
            // inline jika app.js terlambat atau gagal dimuat.
            const logoutButton = sidebarContainer.querySelector(".logout-button");
            if (logoutButton && !logoutButton.dataset.logoutBound) {
                logoutButton.dataset.logoutBound = "true";
                logoutButton.addEventListener("click", async function(event) {
                    event.preventDefault();
                    event.stopImmediatePropagation();
                    if (typeof window.logout === "function") {
                        await window.logout();
                        return;
                    }
                    try {
                        await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
                    } catch (e) {
                        console.warn("LOGOUT SERVER ERROR:", e);
                    }
                    localStorage.removeItem("myworkshop_user");
                    window.location.href = "/";
                }, true);
            }
        } catch (error) {
            console.error("Gagal memuat sidebar:", error);
            sidebarContainer.innerHTML = '<div style="padding:20px;color:#dc2626;font-size:13px">Gagal memuat sidebar.</div>';
        }
    }

    let workshopPrintHeaderPromise = null;

    function workshopPrintEsc(value) {
        return String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    }

    window.getWorkshopPrintHeader = async function () {
        if (!workshopPrintHeaderPromise) {
            workshopPrintHeaderPromise = fetch("/api/workshop/current", { cache: "no-store" })
                .then(async response => {
                    const json = await response.json().catch(() => ({}));
                    if (!response.ok || !json.success) throw new Error(json.message || "Gagal mengambil identitas bengkel.");
                    return json.data || null;
                })
                .catch(error => {
                    console.error("Gagal mengambil kop bengkel:", error);
                    return null;
                });
        }
        const w = await workshopPrintHeaderPromise;
        if (!w) return `<div style="display:block;width:100%;box-sizing:border-box;text-align:center;border-bottom:3px solid #111;padding:0 0 9px;margin:0 0 12px"> <div style="font-size:18px;font-weight:700;line-height:normal">MYWORKSHOP</div><div style="font-size:9px;color:#555;line-height:1.45">Body Repair Management</div></div>`;
        const logo = w.logo_data ? `<img src="${workshopPrintEsc(w.logo_data)}" alt="Logo Bengkel" style="display:block;width:auto;height:auto;max-width:100px;max-height:100px;object-fit:contain;margin:0 0 0.1px">` : "";
        return `<div style="display:block;width:100%;box-sizing:border-box;text-align:left;border-bottom:3px solid #111;padding:0 0 7px;margin:0 0 12px;overflow:visible">${logo}<div style="font-size:18px;font-weight:700;line-height:normal">${workshopPrintEsc(w.name || "-")}</div><div style="font-size:10px;line-height:normal;white-space:pre-line;color:#333">${workshopPrintEsc(w.address || "-")}</div><div style="font-size:10px;line-height:normal;color:#333;white-space:nowrap">Tel: ${workshopPrintEsc(w.phone || w.telephone || w.phone_number || "-")} &nbsp;&nbsp; Email: ${workshopPrintEsc(w.email || "-")}</div></div>`;
    };


    window.refreshMyWorkshopSidebarCounts = refreshSidebarCounts;

    document.addEventListener("DOMContentLoaded", loadSidebar);

    // Jika layout.js dimuat setelah DOMContentLoaded.
    if (document.readyState !== "loading") {
        loadSidebar();
    }
})();
