/* ==========================================================
   MYWORKSHOP - ROLE VISIBILITY & PAGE GUARD
   Menu yang tidak boleh diakses benar-benar disembunyikan.
   Halaman yang dibuka langsung melalui URL juga diblokir.
   ========================================================== */
(function () {
    'use strict';

    const USER_KEY = 'myworkshop_user';

    const RULES = {
        // Dashboard dapat diakses seluruh role yang dapat masuk ke bengkel.
        'super admin': ['dashboard','registrasi','transaksi','produksi','sparepart','billing','laporan','master','super-admin'],
        'super_admin': ['dashboard','registrasi','transaksi','produksi','sparepart','billing','laporan','master','super-admin'],
        'super-admin': ['dashboard','registrasi','transaksi','produksi','sparepart','billing','laporan','master','super-admin'],
        'manager master': ['dashboard','registrasi','transaksi','produksi','sparepart','billing','laporan','master'],
        'manager_master': ['dashboard','registrasi','transaksi','produksi','sparepart','billing','laporan','master'],
        'manager-master': ['dashboard','registrasi','transaksi','produksi','sparepart','billing','laporan','master'],
        'service advisor': ['dashboard','registrasi','transaksi','produksi'],
        'service_advisor': ['dashboard','registrasi','transaksi','produksi'],
        'service-advisor': ['dashboard','registrasi','transaksi','produksi'],
        'billing': ['dashboard','billing','laporan'],
        'sparepart / gudang': ['dashboard','sparepart'],
        'sparepart/gudang': ['dashboard','sparepart'],
        'sparepart': ['dashboard','sparepart'],
        'gudang': ['dashboard','sparepart']
    };

    // Hak akses halaman dibuat eksplisit agar menu tambahan tidak pernah
    // tampil pada role yang tidak berhak.
    const ROLE_PAGES = {
        'super admin': ['super-admin','users'],
        'super_admin': ['super-admin','users'],
        'super-admin': ['super-admin','users'],
        'manager master': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo','tagihan-or','tagihan-kuitansi','pemakaian-bahan','pembayaran','laporan','users'],
        'manager_master': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo','tagihan-or','tagihan-kuitansi','pemakaian-bahan','pembayaran','laporan','users'],
        'manager-master': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo','tagihan-or','tagihan-kuitansi','pemakaian-bahan','pembayaran','laporan','users'],
        'service advisor': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi'],
        'service_advisor': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi'],
        'service-advisor': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi'],
        'billing': ['dashboard','tagihan-or','tagihan-kuitansi','pemakaian-bahan','pembayaran','laporan'],
        'sparepart / gudang': ['dashboard','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo'],
        'sparepart/gudang': ['dashboard','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo'],
        'sparepart': ['dashboard','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo'],
        'gudang': ['dashboard','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo']
    };

    // Hak akses KHUSUS Menu Cepat Dashboard.
    // Estimasi + WO: Service Advisor dan Manager Master.
    // Permintaan + Penerimaan Sparepart Supply: Sparepart/Gudang dan Manager Master.
    // Super Admin mendapat semuanya hanya ketika sedang bertindak sebagai bengkel.
    const QUICK_RULES = {
        'estimasi': ['service advisor', 'service_advisor', 'service-advisor', 'manager master', 'manager_master', 'manager-master'],
        'wo': ['service advisor', 'service_advisor', 'service-advisor', 'manager master', 'manager_master', 'manager-master'],
        'permintaan-sparepart': ['sparepart / gudang', 'sparepart/gudang', 'sparepart', 'gudang', 'manager master', 'manager_master', 'manager-master'],
        'penerimaan-sparepart-supply': ['sparepart / gudang', 'sparepart/gudang', 'sparepart', 'gudang', 'manager master', 'manager_master', 'manager-master']
    };

    function isSuperAdminWorkshopMode(user) {
        if (!isSuperAdmin(user)) return false;
        const values = [
            user.isWorkshopMode, user.workshopMode, user.actingAsWorkshop,
            user.asBengkel, user.masukSebagaiBengkel, user.isBengkelMode,
            localStorage.getItem('myworkshop_workshop_mode'),
            localStorage.getItem('workshop_mode'),
            localStorage.getItem('superadmin_workshop_mode'),
            localStorage.getItem('acting_as_workshop')
        ].map(v => normalize(v));
        return values.some(v => ['true','1','yes','ya','bengkel','workshop'].includes(v));
    }

    function quickAllowed(target, user) {
        const role = getRole(user);
        if (isSuperAdminWorkshopMode(user)) return true;

        const key = normalize(target);
        const allowedRoles = {
            'estimasi': ['service advisor', 'manager master'],
            'wo': ['service advisor', 'manager master'],
            'permintaan sparepart': ['sparepart / gudang', 'manager master'],
            'penerimaan sparepart supply': ['sparepart / gudang', 'manager master']
        };
        return (allowedRoles[key] || []).includes(role);
    }

    const PAGE_GROUPS = {
        'dashboard.html':'dashboard',
        'customer.html':'registrasi',
        'asuransi.html':'registrasi',
        'mobil-masuk.html':'registrasi',
        'estimasi.html':'transaksi',
        'estimasi-selesai.html':'transaksi',
        'wo.html':'produksi',
        'wo-selesai.html':'produksi',
        'produksi.html':'produksi',
        'stok.html':'sparepart',
        'permintaan-sparepart.html':'sparepart',
        'penerimaan-sparepart-supply.html':'sparepart',
        'sparepart-supply-belum-wo.html':'sparepart',
        'tagihan-or.html':'billing',
        'tagihan-kuitansi.html':'billing',
        'pemakaian-bahan.html':'billing',
        'pembayaran.html':'billing',
        'laporan.html':'laporan',
        'users.html':'master',
    };

    const TARGET_GROUPS = {
        dashboard:'dashboard', customer:'registrasi', asuransi:'registrasi', 'mobil-masuk':'registrasi', estimasi:'transaksi', 'estimasi-selesai':'transaksi',
        wo:'produksi', 'wo-selesai':'produksi', produksi:'produksi', stok:'sparepart', barangmasuk:'sparepart',
        barangkeluar:'sparepart', 'permintaan-sparepart':'sparepart',
        'penerimaan-sparepart-supply':'sparepart', 'sparepart-supply-belum-wo':'sparepart', 'pemakaian-bahan':'billing', pembayaran:'billing', laporan:'laporan', users:'master'
    };

    function normalize(v) {
        return String(v || '').trim().toLowerCase().replace(/[_-]+/g, ' ').replace(/\s+/g, ' ');
    }

    function getUser() {
        try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); }
        catch (_) { return null; }
    }

    function getRole(user) {
        if (!user) return '';

        const candidates = [
            user.role?.name,
            user.role?.code,
            user.role_name,
            user.role_code,
            user.role
        ].filter(v => v !== undefined && v !== null && String(v).trim() !== '');

        for (const value of candidates) {
            const role = normalize(value);
            if (role === 'manager master') return 'manager master';
            if (role === 'service advisor') return 'service advisor';
            if (role === 'sparepart / gudang' || role === 'sparepart/gudang' || role === 'sparepart gudang') return 'sparepart / gudang';
            if (role === 'sparepart' || role === 'gudang') return 'sparepart / gudang';
            if (role === 'billing') return 'billing';
            if (role === 'super admin') return 'super admin';
        }
        return '';
    }

    function isSuperAdmin(user) {
        return getRole(user) === 'super admin';
    }

    function isManagerMaster(user) {
        return getRole(user) === 'manager master';
    }

    function allowed(group, user) {
        const role = getRole(user);
        const g = normalize(group);

        if (isSuperAdminWorkshopMode(user)) return true;

        if (role === 'super admin') {
            return ['dashboard', 'super admin', 'super-admin', 'master'].includes(g);
        }

        const roleGroups = {
            'manager master': ['dashboard','registrasi','transaksi','produksi','sparepart','billing','laporan','master'],
            'service advisor': ['dashboard','registrasi','transaksi','produksi'],
            'billing': ['dashboard','billing','laporan'],
            'sparepart / gudang': ['dashboard','sparepart']
        };
        return (roleGroups[role] || []).includes(g);
    }

    function allowedPage(page, user) {
        const role = getRole(user);
        const normalizedPage = String(page || '').toLowerCase().replace(/\.html$/i, '');

        if (isSuperAdminWorkshopMode(user)) return true;
        if (role === 'super admin') return ['dashboard','super-admin','users'].includes(normalizedPage);

        const pages = {
            'manager master': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo','tagihan-or','tagihan-kuitansi','pemakaian-bahan','pembayaran','laporan','users'],
            'service advisor': ['dashboard','customer','asuransi','mobil-masuk','estimasi','estimasi-selesai','wo','wo-selesai','produksi'],
            'billing': ['dashboard','tagihan-or','tagihan-kuitansi','pemakaian-bahan','pembayaran','laporan'],
            'sparepart / gudang': ['dashboard','stok','permintaan-sparepart','penerimaan-sparepart-supply','sparepart-supply-belum-wo']
        };
        return (pages[role] || []).includes(normalizedPage);
    }

    function currentPageGroup() {
        const page = location.pathname.split('/').pop().toLowerCase() || 'dashboard.html';
        return PAGE_GROUPS[page] || 'dashboard';
    }

    function groupFromMenuItem(item) {
        const explicit = normalize(item.dataset.roleGroup);
        if (explicit) return explicit;

        const page = normalize(item.dataset.page);
        if (TARGET_GROUPS[page]) return TARGET_GROUPS[page];

        const href = normalize(item.getAttribute('href'));
        const match = href.match(/([^/]+\.html)(?:[#?].*)?$/i);
        if (match && PAGE_GROUPS[match[1].toLowerCase()]) return PAGE_GROUPS[match[1].toLowerCase()];

        if (item.classList.contains('menu-sparepart')) return 'sparepart';
        if (item.classList.contains('menu-manager')) return 'master';

        const onclick = normalize(item.getAttribute('onclick'));
        const target = onclick.match(/showpage\(['"]([^'"]+)['"]\)/i);
        if (target && TARGET_GROUPS[target[1]]) return TARGET_GROUPS[target[1]];
        return null;
    }

    function groupFromSection(section) {
        const explicit = normalize(section.dataset.menuGroup);
        if (explicit) return explicit;
        const text = normalize(section.textContent);
        if (text.includes('registrasi')) return 'registrasi';
        if (text.includes('transaksi')) return 'transaksi';
        if (text.includes('produksi')) return 'produksi';
        if (text.includes('sparepart') || text.includes('gudang')) return 'sparepart';
        if (text.includes('billing')) return 'billing';
        if (text.includes('laporan')) return 'laporan';
        if (text.includes('super admin')) return 'super-admin';
        if (text.includes('user & role')) return 'master';
        if (text.includes('master') || text.includes('pengaturan')) return 'master';
        if (text.includes('utama')) return 'dashboard';
        return null;
    }

    function warning() {
        if (document.getElementById('mwRoleWarningBackdrop')) return;
        const backdrop = document.createElement('div');
        backdrop.id = 'mwRoleWarningBackdrop';
        backdrop.innerHTML = `
            <div class="mw-role-warning" role="alertdialog" aria-modal="true">
                <div class="mw-role-warning-icon">!</div>
                <h3>Anda tidak memiliki akses!</h3>
                <p>Role Anda tidak memiliki izin untuk mengakses halaman atau menu ini.</p>
                <button type="button">OK</button>
            </div>`;
        document.body.appendChild(backdrop);
        backdrop.querySelector('button').onclick = () => backdrop.remove();
        backdrop.onclick = e => { if (e.target === backdrop) backdrop.remove(); };
    }

    function addStyle() {
        if (document.getElementById('mw-role-visibility-style')) return;
        const s = document.createElement('style');
        s.id = 'mw-role-visibility-style';
        s.textContent = `
            .mw-role-hidden { display:none !important; }
            .mw-role-page-hidden { display:none !important; }
            #mwRoleWarningBackdrop{position:fixed;inset:0;z-index:999999;background:rgba(15,23,42,.48);display:flex;align-items:center;justify-content:center;padding:20px;font-family:Arial,sans-serif}
            .mw-role-warning{width:min(420px,100%);background:#fff;border-radius:14px;padding:24px;box-shadow:0 20px 60px rgba(0,0,0,.25);text-align:center}
            .mw-role-warning-icon{width:46px;height:46px;margin:0 auto 12px;border-radius:50%;background:#fee2e2;color:#b91c1c;display:flex;align-items:center;justify-content:center;font-size:25px;font-weight:800}
            .mw-role-warning h3{margin:0 0 8px;color:#111827;font-size:19px}
            .mw-role-warning p{margin:0 0 18px;color:#64748b;font-size:13px;line-height:1.5}
            .mw-role-warning button{border:0;border-radius:8px;background:#2563eb;color:#fff;padding:9px 22px;cursor:pointer;font-weight:700}
        `;
        document.head.appendChild(s);
    }

    function ensureBillingMaterialMenu() {
        document.querySelectorAll('.sidebar .menu-item[data-page="tagihan-kuitansi"]').forEach(item => {
            const menu = item.closest('.menu');
            if (!menu || menu.querySelector('.menu-item[data-page="pemakaian-bahan"]')) return;

            const a = document.createElement('a');
            a.href = 'pemakaian-bahan.html';
            a.className = 'menu-item';
            a.dataset.page = 'pemakaian-bahan';
            a.innerHTML = '<span class="menu-icon">🧪</span><span>Input Pemakaian Bahan</span>';
            item.insertAdjacentElement('afterend', a);
        });
    }

    function ensureProductionVendorMenu() {
        document.querySelectorAll('.sidebar .menu-item[data-page="wo-selesai"]').forEach(item => {
            if (item.parentElement.querySelector('.menu-item[data-page="produksi"]')) return;
            const a = document.createElement('a');
            a.href = 'produksi.html';
            a.className = 'menu-item';
            a.dataset.page = 'produksi';
            a.innerHTML = '<span class="menu-icon">🔧</span><span>Vendor Produksi</span>';
            item.insertAdjacentElement('afterend', a);
        });
    }

    function ensureEstimasiSelesaiMenu() {
        document.querySelectorAll('.sidebar .menu-item[data-page="estimasi"]').forEach(item => {
            if (item.parentElement.querySelector('.menu-item[data-page="estimasi-selesai"]')) return;
            const a = document.createElement('a');
            a.href = 'estimasi-selesai.html';
            a.className = 'menu-item';
            a.dataset.page = 'estimasi-selesai';
            a.innerHTML = '<span class="menu-icon">✅</span><span>Estimasi Selesai</span>';
            item.insertAdjacentElement('afterend', a);
        });
    }

    function hideUnauthorizedMenus(user) {
        // Role access hanya menentukan HAK AKSES.
        // Jangan menggunakan item.hidden / wrapper.hidden untuk menentukan apakah
        // section kosong, karena hidden tersebut adalah state accordion (buka/tutup),
        // bukan hak akses. Jika dicampur, saat pindah halaman submenu dapat hilang.
        document.querySelectorAll('.sidebar .menu-item').forEach(item => {
            const page = normalize(item.dataset.page);
            const group = groupFromMenuItem(item);
            const pageDenied = page && !allowedPage(page, user);
            const groupDenied = group && !allowed(group, user);
            item.classList.toggle('mw-role-hidden', Boolean(pageDenied || groupDenied));
        });

        document.querySelectorAll('.sidebar .menu-section').forEach(section => {
            const group = groupFromSection(section);
            const denied = group && group !== 'dashboard' && !allowed(group, user);
            section.classList.toggle('mw-role-hidden', Boolean(denied));
        });
    }

    function protectDashboard(user) {
        if (currentPageGroup() !== 'dashboard') return;

        document.querySelectorAll('.quick-button').forEach(btn => {
            const text = normalize(btn.textContent);
            let target = null;

            if (text.includes('penerimaan sparepart supply')) target = 'penerimaan sparepart supply';
            else if (text.includes('permintaan sparepart')) target = 'permintaan sparepart';
            else if (text.includes('work order')) target = 'wo';
            else if (text.includes('estimasi')) target = 'estimasi';

            if (!target || quickAllowed(target, user)) return;
            if (btn.dataset.mwQuickRoleGuard === '1') return;

            btn.dataset.mwQuickRoleGuard = '1';
            btn.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopImmediatePropagation();
                warning();
                return false;
            }, true);
        });
    }

    function protectCurrentPage(user) {
        const page = location.pathname.split('/').pop().toLowerCase() || 'dashboard.html';
        // Hak halaman dicek secara langsung, bukan hanya berdasarkan kelompok menu.
        // Ini memastikan Service Advisor tidak dapat membuka halaman sparepart,
        // dan Sparepart/Gudang tidak dapat membuka Estimasi/WO, termasuk lewat URL.
        if (page === 'dashboard.html') return;
        if (allowedPage(page.replace(/\.html$/i, ''), user)) return;
        document.querySelectorAll('body > .app').forEach(app => app.classList.add('mw-role-page-hidden'));
        warning();
    }

    function bindQuickAccessGuard(user) {
        if (document.documentElement.dataset.mwQuickAccessGuard === '1') return;
        document.documentElement.dataset.mwQuickAccessGuard = '1';

        document.addEventListener('click', function (e) {
            const btn = e.target && e.target.closest ? e.target.closest('.quick-button') : null;
            if (!btn) return;

            const text = normalize(btn.textContent);
            let target = null;
            if (text.includes('penerimaan sparepart supply')) target = 'penerimaan sparepart supply';
            else if (text.includes('permintaan sparepart')) target = 'permintaan sparepart';
            else if (text.includes('work order')) target = 'wo';
            else if (text.includes('estimasi')) target = 'estimasi';

            if (!target || quickAllowed(target, user)) return;

            e.preventDefault();
            e.stopPropagation();
            if (typeof e.stopImmediatePropagation === 'function') e.stopImmediatePropagation();
            warning();
        }, true);
    }

    function guardShowPage(user) {
        const original = window.showPage;
        if (typeof original !== 'function' || window.__mwRoleGuardInstalled) return;
        window.__mwRoleGuardInstalled = true;

        window.showPage = function (target) {
            const normalizedTarget = normalize(target);
            if (normalizedTarget === 'estimasi' || normalizedTarget === 'wo') {
                if (!quickAllowed(normalizedTarget, user)) {
                    warning();
                    return false;
                }
            }
            const group = TARGET_GROUPS[normalizedTarget];
            if (group && !allowed(group, user)) {
                warning();
                return false;
            }
            return original.apply(this, arguments);
        };
    }

    function bindUnauthorizedClicks(user) {
        document.querySelectorAll('.sidebar .menu-item').forEach(item => {
            const group = groupFromMenuItem(item);
            if (!group || allowed(group, user)) return;
            item.addEventListener('click', function (e) {
                e.preventDefault();
                e.stopImmediatePropagation();
                warning();
            }, true);
        });
    }

    function applyToSidebar(user) {
        ensureBillingMaterialMenu();
        ensureEstimasiSelesaiMenu();
        ensureProductionVendorMenu();
        hideUnauthorizedMenus(user);
        bindUnauthorizedClicks(user);
    }

    function setup() {
        addStyle();
        const user = getUser();
        if (!user) return;

        applyToSidebar(user);
        protectDashboard(user);
        bindQuickAccessGuard(user);
        protectCurrentPage(user);
        guardShowPage(user);

        // layout.js memuat sidebar secara asynchronous. Jalankan sekali lagi
        // setelah sidebar selesai dimuat, tanpa observer yang terus-menerus
        // mengubah state accordion saat pengguna berpindah menu.
        setTimeout(() => applyToSidebar(user), 100);
        setTimeout(() => applyToSidebar(user), 500);
    }

    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
    else setup();
})();
