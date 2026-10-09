// ============================================================
// MYWORKSHOP - STATUS ORDER DASHBOARD
// Revisi berdasarkan MyWorkshop.zip terbaru
//
// ATURAN:
// 1. Estimasi Aktif = semua estimasi yang masih ada / belum dihapus.
// 2. WO Aktif       = semua WO dengan status selain CHECK OUT.
// 3. Menunggu Sparepart = SEMUA WO (aktif maupun CHECK OUT) yang memiliki
//    sparepart BENGKEL atau SUPPLY dan minimal satu sparepart belum memiliki
//    tanggal penerimaan. Status WO dan status Tagihan Kuitansi tidak menjadi
//    syarat untuk menghitung Menunggu Sparepart.
// 4. Selesai         = semua WO dengan status CHECK OUT.
//
// Sumber data digabung:
// - API/database
// - localStorage
//
// Penggabungan diperlukan karena aplikasi versi ini menggunakan
// API/database dan localStorage secara bersamaan.
// ============================================================

(function () {
    "use strict";

    // ============================================================
    // WELCOME + JAM BERJALAN DASHBOARD
    // ============================================================

    let dashboardClockTimer = null;

    function dashboardTitleCaseName(value) {
        const text = String(value ?? "").trim();
        if (!text || text === "-") return "User";
        return text.split(/\s+/).map(word =>
            word ? word.charAt(0).toUpperCase() + word.slice(1).toLowerCase() : ""
        ).join(" ");
    }

    function dashboardGreeting(hour) {
        if (hour >= 4 && hour < 11) return "Selamat Pagi";
        if (hour >= 11 && hour < 15) return "Selamat Siang";
        if (hour >= 15 && hour < 18) return "Selamat Sore";
        return "Selamat Malam";
    }

    function updateDashboardWelcomeClock(user) {
        const nameEl = document.getElementById("welcomeName");
        const clockEl = document.getElementById("dashboardLiveClock");
        const dateEl = document.getElementById("dashboardLiveDate");
        if (!nameEl || !clockEl || !dateEl) return;

        const now = new Date();
        const name = dashboardTitleCaseName(
            user?.name ?? user?.full_name ?? user?.fullName ?? user?.nama ??
            user?.nama_user ?? user?.username ?? user?.user_name ?? "User"
        );

        const time = new Intl.DateTimeFormat("id-ID", {
            timeZone: "Asia/Jakarta",
            hour: "2-digit", minute: "2-digit", second: "2-digit",
            hour12: false
        }).format(now);

        const date = new Intl.DateTimeFormat("id-ID", {
            timeZone: "Asia/Jakarta",
            weekday: "long", day: "2-digit", month: "long", year: "numeric"
        }).format(now);

        const jakartaParts = new Intl.DateTimeFormat("en-US", {
            timeZone: "Asia/Jakarta", hour: "2-digit", hour12: false
        }).formatToParts(now);
        const hourPart = Number(jakartaParts.find(part => part.type === "hour")?.value || now.getHours());

        nameEl.textContent = `${dashboardGreeting(hourPart)}, ${name}!`;
        clockEl.textContent = `${time} WIB`;
        dateEl.textContent = date;
    }

    async function startDashboardWelcomeClock() {
        let user = null;
        try {
            user = JSON.parse(localStorage.getItem("myworkshop_user") || "null");
        } catch (_) {}

        // API session menjadi sumber terbaru bila tersedia. Fallback ke localStorage.
        try {
            const response = await fetch("/api/session", { cache: "no-store" });
            const result = await response.json().catch(() => ({}));
            if (response.ok && result?.success && result?.user) {
                user = result.user;
                localStorage.setItem("myworkshop_user", JSON.stringify(user));
            }
        } catch (_) {}

        updateDashboardWelcomeClock(user || {});

        if (dashboardClockTimer) clearInterval(dashboardClockTimer);
        dashboardClockTimer = setInterval(() => updateDashboardWelcomeClock(user || {}), 1000);

        const refreshButton = document.getElementById("dashboardClockRefresh");
        if (refreshButton && refreshButton.dataset.ready !== "1") {
            refreshButton.dataset.ready = "1";
            refreshButton.addEventListener("click", () => updateDashboardWelcomeClock(user || {}));
        }
    }

    // Dashboard menggunakan API/database pusat sebagai satu-satunya sumber data transaksi.
    // localStorage tidak digunakan untuk menghitung angka Dashboard.

    async function apiArray(url) {
        try {
            const response = await fetch(url, {
                headers: { "Content-Type": "application/json" },
                cache: "no-store"
            });

            if (!response.ok) return [];

            const result = await response.json();
            return Array.isArray(result?.data) ? result.data : [];
        } catch (error) {
            console.warn("[Dashboard] API tidak tersedia:", url, error);
            return [];
        }
    }

    // Escape text sebelum dimasukkan ke innerHTML.
    // Dashboard sebelumnya memanggil escapeHTML() pada kartu Check In Again,
    // tetapi fungsi tersebut tidak tersedia di dashboard.js. Akibatnya proses
    // render berhenti setelah jumlah WO diperbarui, sehingga badge bisa 1 WO
    // sementara isi panel tetap menampilkan pesan kosong.
    function escapeHTML(value) {
        return String(value ?? "")
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/\"/g, "&quot;")
            .replace(/'/g, "&#39;");
    }

    function firstValue(obj, names) {
        for (const name of names) {
            const value = obj?.[name];
            if (value !== undefined && value !== null && String(value) !== "") {
                return String(value);
            }
        }
        return "";
    }

    function estimateKey(item) {
        return firstValue(item, [
            "estimate_number", "estimateNumber", "number", "noEstimasi", "id"
        ]);
    }

    function woKey(item) {
        return firstValue(item, [
            "wo_number", "woNumber", "number", "id", "wo_id"
        ]);
    }

    function statusWO(wo) {
        const raw = String(
            wo?.status ??
            wo?.wo_status ??
            "CHECK IN"
        ).trim().toUpperCase();

        // Data lama menggunakan PENGERJAAN. Untuk Dashboard,
        // status tersebut direpresentasikan sebagai tahap BONGKAR.
        return raw === "PENGERJAAN" ? "BONGKAR" : raw;
    }

    function isActiveWO(wo) {
        return statusWO(wo) !== "CHECK OUT";
    }

    function woId(wo) {
        return firstValue(wo, [
            "id", "wo_id", "woId", "wo_number", "woNumber"
        ]);
    }

    function partsOf(wo) {
        const value =
            wo?.spareparts ??
            wo?.sparepart ??
            wo?.items_sparepart ??
            [];

        return Array.isArray(value) ? value : [];
    }

    function partType(part) {
        return String(
            part?.supply_bengkel ??
            part?.supplyBengkel ??
            part?.supply ??
            part?.source ??
            "BENGKEL"
        ).trim().toUpperCase();
    }

    function hasDate(value) {
        return value !== undefined &&
               value !== null &&
               String(value).trim() !== "";
    }

    function arrivalDate(record) {
        return record?.arrival_date ??
               record?.arrivalDate ??
               record?.tanggal_penerimaan ??
               record?.tanggalPenerimaan ??
               record?.received_date ??
               record?.date ??
               "";
    }

    function findPO(purchaseOrders, id, woNumber) {
        return purchaseOrders.find(po => {
            const poId = firstValue(po, ["wo_id", "woId", "wo_number", "woNumber"]);
            return String(poId) === String(id) ||
                   (woNumber && String(poId) === String(woNumber));
        }) || null;
    }

    function partMatches(arrival, part, index) {
        const savedIndex = Number(
            arrival?.item_index ??
            arrival?.itemIndex ??
            arrival?.index
        );

        if (Number.isFinite(savedIndex) && savedIndex === Number(index)) {
            return true;
        }

        const savedId = firstValue(arrival, ["part_id", "partId", "estimate_sparepart_id"]);
        const currentId = firstValue(part, ["id", "part_id", "partId"]);
        if (savedId && currentId && String(savedId) === String(currentId)) return true;

        const savedPart =
            firstValue(arrival, ["part_number", "partNumber", "sku", "part_name", "partName", "name"]);

        const currentPart =
            firstValue(part, ["part_number", "partNumber", "sku", "part_name", "partName", "name"]);

        return Boolean(savedPart && currentPart && String(savedPart).trim().toUpperCase() === String(currentPart).trim().toUpperCase());
    }

    // True jika minimal satu sparepart pada WO belum memiliki tanggal penerimaan.
    function hasPendingSparepart(wo, purchaseOrders, supplyArrivals) {
        const parts = partsOf(wo);
        if (!parts.length) return false;

        const id = woId(wo);
        const number = firstValue(wo, ["wo_number", "woNumber", "number"]);
        const po = findPO(purchaseOrders, id, number);
        const poItems = Array.isArray(po?.items) ? po.items : [];

        // Indeks PO BENGKEL mengikuti urutan sparepart BENGKEL saja.
        let bengkelIndex = 0;

        for (let originalIndex = 0; originalIndex < parts.length; originalIndex++) {
            const part = parts[originalIndex];
            const type = partType(part);

            if (type === "SUPPLY") {
                const arrival = supplyArrivals.find(record => {
                    const arrivalWO =
                        firstValue(record, ["wo_id", "woId", "wo_number", "woNumber"]);

                    const sameWO =
                        String(arrivalWO) === String(id) ||
                        (number && String(arrivalWO) === String(number));

                    return sameWO && partMatches(record, part, originalIndex);
                });

                if (!hasDate(arrivalDate(arrival))) {
                    return true;
                }

                continue;
            }

            // Semua tipe selain SUPPLY diperlakukan sebagai BENGKEL.
            const poItem = poItems[bengkelIndex];
            bengkelIndex++;

            if (!hasDate(arrivalDate(poItem))) {
                return true;
            }
        }

        return false;
    }

    async function loadWOFromAPI() {
        // Endpoint /api/wo sudah mengirim detail sparepart dari database pusat,
        // termasuk supply_bengkel. Tidak perlu mengambil data dari localStorage
        // atau menggabungkan ulang dengan detail WO per satu.
        return apiArray("/api/wo");
    }

    function setNumber(id, value) {
        const element = document.getElementById(id);
        if (element) element.textContent = String(value);
    }

    // Ambil bagian tanggal saja agar perbandingan tidak dipengaruhi jam/timezone.
    function dateOnly(value) {
        if (value === undefined || value === null || String(value).trim() === "") {
            return null;
        }

        const raw = String(value).trim();
        let match = raw.match(/^(\d{4})[-\/](\d{1,2})[-\/](\d{1,2})/);

        if (match) {
            return `${match[1]}-${String(match[2]).padStart(2, "0")}-${String(match[3]).padStart(2, "0")}`;
        }

        // Dukungan untuk format DD-MM-YYYY / DD/MM/YYYY.
        match = raw.match(/^(\d{1,2})[-\/](\d{1,2})[-\/](\d{4})/);
        if (match) {
            return `${match[3]}-${String(match[2]).padStart(2, "0")}-${String(match[1]).padStart(2, "0")}`;
        }

        const parsed = new Date(raw);
        if (Number.isNaN(parsed.getTime())) return null;

        return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, "0")}-${String(parsed.getDate()).padStart(2, "0")}`;
    }

    function targetDateOf(wo) {
        return dateOnly(firstValue(wo, [
            "target_date", "targetDate", "tanggal_target", "tanggalTarget"
        ]));
    }

    function checkOutDateOf(wo) {
        return dateOnly(firstValue(wo, [
            "check_out_at", "checkOutAt", "check_out_date", "checkOutDate", "tanggal_check_out", "tanggalCheckOut"
        ]));
    }

    function calculateTimeliness(woList) {
        let timely = 0;
        let late = 0;

        woList.forEach(wo => {
            // Hanya WO yang sudah CHECK OUT dan memiliki kedua tanggal yang dinilai.
            if (statusWO(wo) !== "CHECK OUT") return;

            const target = targetDateOf(wo);
            const checkOut = checkOutDateOf(wo);
            if (!target || !checkOut) return;

            if (checkOut <= target) {
                timely++;
            } else {
                late++;
            }
        });

        return { timely, late, total: timely + late };
    }

    function renderTimelinessChart(data) {
        const chart = document.getElementById("dashboardTimelinessChart");
        if (!chart) return;

        const total = Number(data?.total || 0);
        const timely = Number(data?.timely || 0);
        const late = Number(data?.late || 0);
        const timelyPercent = total ? (timely / total) * 100 : 0;
        const latePercent = total ? (late / total) * 100 : 0;
        const timelyDegrees = timelyPercent * 3.6;

        chart.style.background = total
            ? `conic-gradient(#16a34a 0deg ${timelyDegrees}deg, #ef4444 ${timelyDegrees}deg 360deg)`
            : "conic-gradient(#e5e7eb 0deg 360deg)";

        chart.title = total
            ? `Tepat Waktu: ${timely} WO (${timelyPercent.toFixed(1)}%) · Terlambat: ${late} WO (${latePercent.toFixed(1)}%)`
            : "Belum ada WO CHECK OUT yang dapat dinilai";

        setNumber("dashboardTimelinessTotal", total);
        setNumber("dashboardTimelyCount", timely);
        setNumber("dashboardTimelyPercent", `${timelyPercent.toFixed(1)}%`);
        setNumber("dashboardLateCount", late);
        setNumber("dashboardLatePercent", `${latePercent.toFixed(1)}%`);
    }


    let checkInAgainTimer = null;
    let checkInAgainRecords = [];
    let checkInAgainIndex = 0;

    function checkInAgainHistoryOf(wo) {
        const value = wo?.process_history ?? wo?.processHistory ?? [];
        return Array.isArray(value) ? value : [];
    }

    async function loadCheckInAgainRecords(woList) {
        // Sumber utama: endpoint khusus Dashboard yang menghitung siklus
        // Check In Again aktif langsung dari wo_process_history di database.
        // Ini menghindari ketergantungan pada bentuk detail WO/history di frontend.
        try {
            const response = await fetch(`/api/dashboard/check-in-again?_=${Date.now()}`, {
                headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
                cache: "no-store"
            });

            if (response.ok) {
                const result = await response.json();
                if (result?.success && Array.isArray(result.data)) {
                    const records = result.data.map(record => ({
                        key: `${record.wo_id}-${record.id}`,
                        woId: record.wo_id,
                        customer: record.customer_name || "Customer tidak tersedia",
                        brand: record.brand || "",
                        model: record.model || "",
                        plate: record.plate_number || "",
                        changedAt: record.changed_at || "",
                        note: record.note || "-"
                    }));
                    console.log(`[Dashboard] Check In Again aktif: ${records.length} WO`);
                    return records;
                }
            }
        } catch (error) {
            console.warn("[Dashboard] endpoint Check In Again aktif gagal, memakai fallback:", error);
        }

        // Fallback untuk kompatibilitas bila server belum memuat endpoint baru.
        const records = [];
        const results = await Promise.all((woList || []).map(async (wo) => {
            const id = woId(wo);
            let history = checkInAgainHistoryOf(wo);

            if (id) {
                try {
                    const response = await fetch(`/api/wo/${encodeURIComponent(id)}/history`, {
                        headers: { "Content-Type": "application/json" },
                        cache: "no-store"
                    });
                    if (response.ok) {
                        const result = await response.json();
                        const apiHistory = Array.isArray(result?.data?.history) ? result.data.history : [];
                        if (apiHistory.length) history = apiHistory;
                    }
                } catch (_) {}
            }

            const normalizedHistory = history
                .filter(item => item && item?.changed_at)
                .sort((a, b) => new Date(a.changed_at).getTime() - new Date(b.changed_at).getTime());

            const again = normalizedHistory.filter(item =>
                String(item?.status || "").trim().toUpperCase() === "CHECK IN AGAIN"
            );
            if (!again.length) return null;

            const latestAgain = again[again.length - 1];
            const latestAgainIndex = normalizedHistory.lastIndexOf(latestAgain);
            const hasCheckoutAfter = normalizedHistory.some((item, index) =>
                index > latestAgainIndex &&
                String(item?.status || "").trim().toUpperCase() === "CHECK OUT"
            );
            if (hasCheckoutAfter) return null;

            return {
                key: `${woKey(wo)}-${latestAgain.id || latestAgain.changed_at}`,
                woId: id,
                customer: firstValue(wo, ["customer_name", "customerName", "name_customer", "customer"]),
                brand: firstValue(wo, ["brand", "vehicle_brand", "merek"]),
                model: firstValue(wo, ["model", "vehicle_model", "type", "vehicle_type", "tipe"]),
                plate: firstValue(wo, ["plate_number", "plateNumber", "no_polisi", "noPolisi"]),
                changedAt: latestAgain.changed_at,
                note: firstValue(latestAgain, ["note", "keterangan", "description"]) || "-"
            };
        }));

        results.filter(Boolean).forEach(record => records.push(record));
        return records.sort((a, b) => new Date(b.changedAt || 0) - new Date(a.changedAt || 0));
    }

    function formatCheckInAgainDate(value) {
        if (!value) return "-";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return new Intl.DateTimeFormat("id-ID", {
            day: "2-digit",
            month: "short",
            year: "numeric",
            hour: "2-digit",
            minute: "2-digit",
            hour12: false
        }).format(date).replace(".", ":");
    }

    function renderCheckInAgain(records) {
        const container = document.getElementById("dashboardCheckInAgainLive");
        const dots = document.getElementById("dashboardCheckInAgainDots");
        const count = document.getElementById("dashboardCheckInAgainCount");
        if (!container || !dots || !count) return;

        clearInterval(checkInAgainTimer);
        checkInAgainTimer = null;
        checkInAgainRecords = Array.isArray(records) ? records : [];
        checkInAgainIndex = 0;
        count.textContent = `${checkInAgainRecords.length} WO`;

        if (!checkInAgainRecords.length) {
            container.innerHTML = '<div class="checkin-again-empty">Belum ada WO yang melakukan Check In Again.</div>';
            dots.innerHTML = "";
            return;
        }

        dots.innerHTML = checkInAgainRecords.map((_, index) =>
            `<span class="checkin-again-dot${index === 0 ? " active" : ""}"></span>`
        ).join("");

        function makeCard(record, state = "") {
            const customer = record.customer || "Customer tidak tersedia";
            const car = [record.brand, record.model].filter(Boolean).join(" ") || "Mobil tidak tersedia";
            const plate = record.plate ? ` · ${record.plate}` : "";
            return `
                <div class="checkin-again-card ${state}" data-checkin-key="${String(record.key).replace(/"/g, '&quot;')}">
                    <div class="checkin-again-card-icon">🔄</div>
                    <div class="checkin-again-card-body">
                        <div class="checkin-again-card-title">${escapeHTML(customer)}</div>
                        <div class="checkin-again-card-meta">
                            <div class="checkin-again-field">
                                <label>Merek / Type Mobil</label>
                                <span>${escapeHTML(car + plate)}</span>
                            </div>
                            <div class="checkin-again-field">
                                <label>Tanggal Check In Again</label>
                                <span>${escapeHTML(formatCheckInAgainDate(record.changedAt))}</span>
                            </div>
                            <div class="checkin-again-field note">
                                <label>Keterangan</label>
                                <span title="${escapeHTML(record.note || "-")}">${escapeHTML(record.note || "-")}</span>
                            </div>
                        </div>
                    </div>
                </div>`;
        }

        container.innerHTML = makeCard(checkInAgainRecords[0]);

        if (checkInAgainRecords.length <= 1) return;

        checkInAgainTimer = setInterval(() => {
            const current = container.querySelector(".checkin-again-card");
            if (!current) return;

            const nextIndex = (checkInAgainIndex + 1) % checkInAgainRecords.length;
            const nextCard = document.createElement("div");
            nextCard.innerHTML = makeCard(checkInAgainRecords[nextIndex], "entering");
            const next = nextCard.firstElementChild;
            container.appendChild(next);

            requestAnimationFrame(() => {
                current.classList.add("leaving");
                next.classList.remove("entering");
            });

            setTimeout(() => {
                current.remove();
                checkInAgainIndex = nextIndex;
                [...dots.children].forEach((dot, i) => dot.classList.toggle("active", i === checkInAgainIndex));
            }, 470);
        }, 4000);
    }

    async function loadCentralStorageArray(key) {
        try {
            const response = await fetch(`/api/storage/${encodeURIComponent(key)}`, {
                headers: { "Content-Type": "application/json" },
                cache: "no-store"
            });
            if (!response.ok) return [];
            const result = await response.json();
            return Array.isArray(result?.data) ? result.data : [];
        } catch (error) {
            console.warn(`[Dashboard] gagal membaca storage ${key}:`, error);
            return [];
        }
    }

    async function refreshDashboardStatus() {
        const [
            estimasiAPI,
            woAPI
        ] = await Promise.all([
            apiArray("/api/estimasi"),
            loadWOFromAPI()
        ]);

        const estimasi = Array.isArray(estimasiAPI) ? estimasiAPI : [];
        const wo = Array.isArray(woAPI) ? woAPI : [];

        // Estimasi Aktif = estimasi yang belum masuk menu Estimasi Selesai.
        // Status SELESAI adalah status yang ditetapkan saat tagihan kuitansi
        // berhasil dibuat. Status DRAFT/DIBUAT/APPROVED tetap aktif.
        const estimasiAktif = estimasi.filter(item => {
            const status = String(
                item?.status ??
                item?.estimate_status ??
                "DIBUAT"
            ).trim().toUpperCase();

            return status !== "SELESAI";
        }).length;

        // Data Purchase Order dan penerimaan Supply juga dibaca dari database
        // pusat melalui endpoint storage, bukan localStorage browser.
        const purchaseOrders = await loadCentralStorageArray("purchase_orders");
        const supplyArrivals = await loadCentralStorageArray("supply_arrivals");

        const woAktif = wo.filter(isActiveWO);
        const selesai = wo.filter(item => statusWO(item) === "CHECK OUT");
        const timeliness = calculateTimeliness(wo);

        // Menunggu Sparepart = semua WO, baik masih aktif maupun sudah CHECK OUT,
        // selama masih ada minimal satu sparepart BENGKEL atau SUPPLY yang belum
        // diterima. Jangan batasi dengan woAktif dan jangan bergantung pada
        // Tagihan Kuitansi.
        const menungguSparepart = wo.filter(woItem =>
            hasPendingSparepart(
                woItem,
                purchaseOrders,
                supplyArrivals
            )
        );

        const statusCounts = {
            "CHECK IN": 0,
            "BONGKAR": 0,
            "DEMPUL": 0,
            "CAT": 0,
            "FINISHING": 0,
            "SELESAI": 0,
            "CHECK OUT": 0
        };

        wo.forEach(item => {
            const status = statusWO(item);
            if (Object.prototype.hasOwnProperty.call(statusCounts, status)) {
                statusCounts[status]++;
            }
        });

        setNumber("dashboardStatusCheckIn", statusCounts["CHECK IN"]);
        setNumber("dashboardStatusBongkar", statusCounts["BONGKAR"]);
        setNumber("dashboardStatusDempul", statusCounts["DEMPUL"]);
        setNumber("dashboardStatusCat", statusCounts["CAT"]);
        setNumber("dashboardStatusFinishing", statusCounts["FINISHING"]);
        setNumber("dashboardStatusSelesai", statusCounts["SELESAI"]);
        setNumber("dashboardStatusCheckOut", statusCounts["CHECK OUT"]);

        setNumber("dashboardEstimasiAktif", estimasiAktif);
        setNumber("dashboardWOAktif", woAktif.length);
        setNumber("dashboardMenungguSparepart", menungguSparepart.length);
        setNumber("dashboardSelesai", selesai.length);
        renderTimelinessChart(timeliness);

        const checkInAgain = await loadCheckInAgainRecords(wo);
        renderCheckInAgain(checkInAgain);

        // Berguna untuk pengecekan tanpa mengubah tampilan.
        window.myWorkshopDashboardStatus = {
            estimasiAktif,
            woAktif: woAktif.length,
            menungguSparepart: menungguSparepart.length,
            selesai: selesai.length,
            timeliness,
            statusCounts,
            totalEstimasiSumberAPI: estimasiAPI.length,
            totalWOSumberAPI: woAPI.length
        };

        return window.myWorkshopDashboardStatus;
    }

    function formatRupiah(value) {
        const number = Math.max(0, Number(value) || 0);
        return "Rp" + new Intl.NumberFormat("id-ID", {
            maximumFractionDigits: 0
        }).format(number);
    }

    function renderDashboardBillingTooltip(element, monthLabel, categoryLabel, value) {
        const tooltip = document.getElementById("dashboardBillingValueTooltip");
        if (!tooltip || !element) return;
        tooltip.innerHTML = `
            <div class="billing-value-tooltip-title">${escapeHTML(monthLabel || "-")}</div>
            <div class="billing-value-tooltip-label">${escapeHTML(categoryLabel || "Nilai")}</div>
            <div class="billing-value-tooltip-value">${formatRupiah(value)}</div>`;
        tooltip.classList.add("show");
        tooltip.setAttribute("aria-hidden", "false");
        const rect = element.getBoundingClientRect();
        const gap = 10;
        const width = tooltip.offsetWidth;
        const height = tooltip.offsetHeight;
        let left = rect.left + (rect.width / 2) - (width / 2);
        let top = rect.top - height - gap;
        if (top < 8) top = rect.bottom + gap;
        left = Math.max(8, Math.min(left, window.innerWidth - width - 8));
        tooltip.style.left = `${left}px`;
        tooltip.style.top = `${top}px`;
    }

    function hideDashboardBillingTooltip() {
        const tooltip = document.getElementById("dashboardBillingValueTooltip");
        if (!tooltip) return;
        tooltip.classList.remove("show");
        tooltip.setAttribute("aria-hidden", "true");
    }

    function bindDashboardBillingTooltips(root) {
        if (!root) return;
        root.querySelectorAll(".billing-bar-fill").forEach(bar => {
            if (bar.dataset.tooltipReady === "1") return;
            bar.dataset.tooltipReady = "1";
            const group = bar.closest(".billing-month-group");
            const monthLabel = group?.querySelector(".billing-month-label")?.textContent || "";
            const categoryLabel = bar.dataset.billingLabel || bar.getAttribute("title")?.split(":")[0] || "Nilai";
            const rawValue = Number(bar.dataset.billingValue || 0);
            bar.removeAttribute("title");
            const show = () => renderDashboardBillingTooltip(bar, monthLabel, categoryLabel, rawValue);
            bar.addEventListener("mouseenter", show);
            bar.addEventListener("mousemove", show);
            bar.addEventListener("mouseleave", hideDashboardBillingTooltip);
            bar.addEventListener("focus", show);
            bar.addEventListener("blur", hideDashboardBillingTooltip);
            bar.addEventListener("touchstart", show, { passive: true });
            bar.addEventListener("click", show);
        });
    }

    function renderDashboardBillingSingleSeries(grid, months, key, maxValue, cssClass, labelKey) {
        if (!grid) return;
        grid.innerHTML = months.map(item => {
            const value = Math.max(0, Number(item?.[key]) || 0);
            const height = value > 0 ? Math.max(2, (value / maxValue) * 100) : 0;
            return `
                <div class="billing-month-group">
                    <div class="billing-month-bars">
                        <div class="billing-bar-track">
                            <div class="billing-month-value">${formatRupiah(value)}</div>
                            <div class="billing-bar-fill ${cssClass || ""}" tabindex="0" data-billing-label="${escapeHTML(labelKey)}" data-billing-value="${value}" style="height:${height}%;"></div>
                        </div>
                    </div>
                    <div class="billing-month-label">${escapeHTML(item?.label || "-")}</div>
                </div>`;
        }).join("");
        bindDashboardBillingTooltips(grid);
    }

    function renderDashboardBillingOR(grid, months) {
        if (!grid) return;
        const maxValue = Math.max(1, ...months.map(item => Math.max(Number(item?.or_paid) || 0, Number(item?.or_unpaid) || 0)));
        grid.innerHTML = months.map(item => {
            const paid = Math.max(0, Number(item?.or_paid) || 0);
            const unpaid = Math.max(0, Number(item?.or_unpaid) || 0);
            const paidHeight = paid > 0 ? Math.max(2, (paid / maxValue) * 100) : 0;
            const unpaidHeight = unpaid > 0 ? Math.max(2, (unpaid / maxValue) * 100) : 0;
            return `
                <div class="billing-month-group">
                    <div class="billing-month-bars">
                        <div class="billing-bar-track">
                            <div class="billing-month-value">${formatRupiah(paid)}</div>
                            <div class="billing-bar-fill paid" tabindex="0" data-billing-label="Sudah Dibayar" data-billing-value="${paid}" style="height:${paidHeight}%;"></div>
                        </div>
                        <div class="billing-bar-track">
                            <div class="billing-month-value">${formatRupiah(unpaid)}</div>
                            <div class="billing-bar-fill unpaid" tabindex="0" data-billing-label="Belum Dibayar" data-billing-value="${unpaid}" style="height:${unpaidHeight}%;"></div>
                        </div>
                    </div>
                    <div class="billing-month-label">${escapeHTML(item?.label || "-")}</div>
                </div>`;
        }).join("");
        bindDashboardBillingTooltips(grid);
    }

    function dashboardBillingMonthIndex(value, year) {
        if (!value) return -1;
        const text = String(value);
        const direct = text.match(/^(?:\d{4}[-/]?)(\d{1,2})/);
        if (direct) {
            const month = Number(direct[1]);
            return month >= 1 && month <= 12 ? month - 1 : -1;
        }
        const parsed = new Date(value);
        if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() === year) return parsed.getMonth();
        return -1;
    }

    function populateDashboardBillingInsurerFilter(rows) {
        const select = document.getElementById("dashboardBillingPaymentInsurerFilter");
        if (!select) return;
        const current = String(select.value || "");
        const insurers = new Map();
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const id = String(row?.insurer_id ?? row?.insurer_code ?? row?.insurer_name ?? "").trim();
            const alias = String(row?.insurer_alias ?? row?.insurer_name ?? row?.insurer_code ?? "").trim();
            if (!id || !alias) return;
            if (!insurers.has(id)) insurers.set(id, alias);
        });
        const options = ['<option value="">Semua Asuransi</option>'];
        [...insurers.entries()]
            .sort((a,b) => a[1].localeCompare(b[1], "id-ID", {sensitivity:"base"}))
            .forEach(([id, alias]) => options.push(`<option value="${escapeHTML(id)}">${escapeHTML(alias)}</option>`));
        select.innerHTML = options.join("");
        if ([...insurers.keys()].includes(current)) select.value = current;
    }

    function buildDashboardBillingPaymentMonths(rows, payments, year, insurerId) {
        const labels = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
        const months = labels.map(label => ({label, paid:0, unpaid:0}));
        const paymentMap = new Map();
        (Array.isArray(payments) ? payments : []).forEach(row => {
            const wid = String(row?.wo_id ?? "").trim();
            if (!wid) return;
            const paidAt = String(row?.paid_at ?? "").trim();
            if (paidAt) paymentMap.set(wid, row);
        });
        (Array.isArray(rows) ? rows : []).forEach(row => {
            const createdAt = row?.kuitansi_created_at ?? row?.created_at ?? "";
            const idx = dashboardBillingMonthIndex(createdAt, year);
            if (idx < 0 || idx > 11) return;
            const rowInsurerId = String(row?.insurer_id ?? row?.insurer_code ?? row?.insurer_name ?? "").trim();
            if (insurerId && rowInsurerId !== String(insurerId)) return;
            const amount = Math.max(0, Number(row?.grand_total) || 0);
            if (amount <= 0) return;
            const wid = String(row?.wo_id ?? "").trim();
            if (wid && paymentMap.has(wid)) months[idx].paid += amount;
            else months[idx].unpaid += amount;
        });
        return months;
    }

    function renderDashboardBillingPayment(grid, months) {
        if (!grid) return;
        const maxValue = Math.max(1, ...months.map(item => Math.max(Number(item?.paid) || 0, Number(item?.unpaid) || 0)));
        grid.innerHTML = months.map(item => {
            const paid = Math.max(0, Number(item?.paid) || 0);
            const unpaid = Math.max(0, Number(item?.unpaid) || 0);
            const paidHeight = paid > 0 ? Math.max(2, (paid / maxValue) * 100) : 0;
            const unpaidHeight = unpaid > 0 ? Math.max(2, (unpaid / maxValue) * 100) : 0;
            return `
                <div class="billing-month-group">
                    <div class="billing-month-bars">
                        <div class="billing-bar-track">
                            <div class="billing-month-value">${formatRupiah(paid)}</div>
                            <div class="billing-bar-fill paid" tabindex="0" data-billing-label="Sudah Dibayar" data-billing-value="${paid}" style="height:${paidHeight}%;"></div>
                        </div>
                        <div class="billing-bar-track">
                            <div class="billing-month-value">${formatRupiah(unpaid)}</div>
                            <div class="billing-bar-fill unpaid" tabindex="0" data-billing-label="Belum Dibayar" data-billing-value="${unpaid}" style="height:${unpaidHeight}%;"></div>
                        </div>
                    </div>
                    <div class="billing-month-label">${escapeHTML(item?.label || "-")}</div>
                </div>`;
        }).join("");
        bindDashboardBillingTooltips(grid);
    }

    function setupDashboardBillingCarousel() {
        const track = document.getElementById("dashboardBillingCarouselTrack");
        const prev = document.getElementById("dashboardBillingPrev");
        const next = document.getElementById("dashboardBillingNext");
        const indicator = document.getElementById("dashboardBillingIndicator");
        const viewport = document.getElementById("dashboardBillingCarouselViewport");
        if (!track || !prev || !next || !indicator || !viewport || track.dataset.ready === "1") return;

        const labels = ["Nilai OR Dibayar", "Nilai Tagihan Dibuat", "Pembayaran"];
        let index = 0;
        let startX = null;

        const render = () => {
            track.style.transform = `translateX(-${index * 33.3333333333}%)`;
            indicator.textContent = `${index + 1} / ${labels.length} · ${labels[index]}`;
            prev.disabled = index === 0;
            next.disabled = index === labels.length - 1;
        };
        const go = delta => {
            const nextIndex = Math.max(0, Math.min(labels.length - 1, index + delta));
            if (nextIndex !== index) {
                index = nextIndex;
                render();
            }
        };

        prev.addEventListener("click", () => go(-1));
        next.addEventListener("click", () => go(1));
        viewport.addEventListener("touchstart", e => {
            startX = e.touches?.[0]?.clientX ?? null;
        }, { passive: true });
        viewport.addEventListener("touchend", e => {
            if (startX == null) return;
            const endX = e.changedTouches?.[0]?.clientX ?? startX;
            const diff = endX - startX;
            startX = null;
            if (Math.abs(diff) >= 45) go(diff < 0 ? 1 : -1);
        }, { passive: true });
        track.dataset.ready = "1";
        render();
    }

    async function loadDashboardBillingSummary() {
        const panel = document.getElementById("dashboardBillingSummaryPanel");
        if (!panel) return;

        try {
            const sessionResponse = await fetch("/api/session", {
                headers: { "Content-Type": "application/json" },
                cache: "no-store"
            });
            if (!sessionResponse.ok) return;
            const sessionResult = await sessionResponse.json();
            const user = sessionResult?.user || {};
            const roleCode = String(user?.role?.code || user?.role_code || "").trim().toUpperCase();
            const roleName = String(user?.role?.name || user?.role_name || "").trim().toUpperCase();
            const allowed = ["MANAGER_MASTER", "BILLING"].includes(roleCode) ||
                ["MANAGER MASTER", "BILLING"].includes(roleName);

            panel.style.display = allowed ? "block" : "none";
            if (!allowed) return;

            const response = await fetch(`/api/dashboard/billing-summary?_=${Date.now()}`, {
                headers: { "Content-Type": "application/json" },
                cache: "no-store"
            });
            if (!response.ok) return;
            const result = await response.json();
            const data = result?.data || {};
            const months = Array.isArray(data.months) ? data.months : [];
            months.forEach(item => { item.year = data.year; });

            // OR: Sudah Dibayar dikelompokkan berdasarkan tanggal pembayaran OR.
            // OR: Belum Dibayar menggunakan sisa OR dan dikelompokkan berdasarkan tanggal WO CHECK OUT.
            // Dengan cara ini OR parsial tetap tercermin sebagai dibayar + belum dibayar.
            try {
                const year = Number(data.year) || new Date().getFullYear();
                const from = `${year}-01-01`;
                const to = `${year}-12-31`;
                const [paidResponse, outstandingResponse] = await Promise.all([
                    fetch(`/api/laporan/own-risk?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&_=${Date.now()}`, { headers: { "Content-Type": "application/json" }, cache: "no-store" }),
                    fetch(`/api/tagihan-or?_=${Date.now()}`, { headers: { "Content-Type": "application/json" }, cache: "no-store" })
                ]);
                const paidResult = paidResponse.ok ? await paidResponse.json() : {};
                const outstandingResult = outstandingResponse.ok ? await outstandingResponse.json() : {};
                const monthMap = new Map(months.map((item, index) => [index, item]));
                const monthIndex = value => {
                    if (!value) return -1;
                    const match = String(value).match(/^(?:\d{4}[-/]?)(\d{1,2})/);
                    if (match) {
                        const month = Number(match[1]);
                        if (month >= 1 && month <= 12) return month - 1;
                    }
                    const parsed = new Date(value);
                    if (!Number.isNaN(parsed.getTime()) && parsed.getFullYear() === year) return parsed.getMonth();
                    return -1;
                };
                months.forEach(item => { item.or_paid = 0; item.or_unpaid = 0; });
                (Array.isArray(paidResult?.data) ? paidResult.data : []).forEach(row => {
                    const idx = monthIndex(row?.paid_at);
                    if (idx < 0 || !monthMap.has(idx)) return;
                    monthMap.get(idx).or_paid += Math.max(0, Number(row?.amount) || 0);
                });
                (Array.isArray(outstandingResult?.data) ? outstandingResult.data : []).forEach(row => {
                    const remaining = Math.max(0, Number(row?.remaining_amount) || 0);
                    if (remaining <= 0) return;
                    const idx = monthIndex(row?.check_out_at || row?.wo_created_at);
                    if (idx < 0 || !monthMap.has(idx)) return;
                    monthMap.get(idx).or_unpaid += remaining;
                });
            } catch (orError) {
                console.warn("[Dashboard] gagal memuat rincian Sudah Dibayar/Belum Dibayar OR:", orError);
                months.forEach(item => {
                    item.or_paid = Math.max(0, Number(item?.or_paid) || 0);
                    item.or_unpaid = Math.max(0, Number(item?.or_unpaid) || 0);
                });
            }

            const tagihanMax = Math.max(1, ...months.map(item => Number(item?.tagihan_dibuat) || 0));
            renderDashboardBillingOR(document.getElementById("dashboardBillingORGrid"), months);
            renderDashboardBillingSingleSeries(document.getElementById("dashboardBillingTagihanGrid"), months, "tagihan_dibuat", tagihanMax, "tagihan", "Nilai Tagihan Dibuat");

            const paymentFilter = document.getElementById("dashboardBillingPaymentInsurerFilter");
            let paymentBills = [];
            let paymentRows = [];
            try {
                const [billResponse, paymentResponse] = await Promise.all([
                    fetch(`/api/tagihan-kuitansi?_=${Date.now()}`, { headers: { "Content-Type": "application/json" }, cache: "no-store" }),
                    fetch(`/api/pembayaran?_=${Date.now()}`, { headers: { "Content-Type": "application/json" }, cache: "no-store" })
                ]);
                const billResult = billResponse.ok ? await billResponse.json() : {};
                const paymentResult = paymentResponse.ok ? await paymentResponse.json() : {};
                paymentBills = Array.isArray(billResult?.data) ? billResult.data : [];
                paymentRows = Array.isArray(paymentResult?.data) ? paymentResult.data : [];
            } catch (paymentLoadError) {
                console.warn("[Dashboard] gagal memuat data filter Asuransi Pembayaran:", paymentLoadError);
            }

            const paymentYear = Number(data.year) || new Date().getFullYear();
            populateDashboardBillingInsurerFilter(paymentBills);
            const renderPaymentByInsurer = () => {
                const selectedInsurer = String(paymentFilter?.value || "");
                const paymentMonths = buildDashboardBillingPaymentMonths(paymentBills, paymentRows, paymentYear, selectedInsurer);
                renderDashboardBillingPayment(document.getElementById("dashboardBillingPaymentGrid"), paymentMonths);
            };
            if (paymentFilter && paymentFilter.dataset.ready !== "1") {
                paymentFilter.addEventListener("change", renderPaymentByInsurer);
                paymentFilter.dataset.ready = "1";
            }
            renderPaymentByInsurer();
            setupDashboardBillingCarousel();
        } catch (error) {
            console.warn("[Dashboard] gagal memuat ringkasan nilai billing:", error);
        }
    }

    async function loadDashboardWorkshopIdentity() {
        const topbarTitle = document.getElementById("dashboardWorkshopTopbarIdentity") || document.querySelector(".topbar-title");
        const nameEl = document.getElementById("dashboardWorkshopName");
        const logoWrap = document.getElementById("dashboardWorkshopLogoWrap");
        const logoEl = document.getElementById("dashboardWorkshopLogo");
        const addressEl = document.getElementById("dashboardWorkshopAddress");
        if (!nameEl || !addressEl) return;

        if (topbarTitle) {
            topbarTitle.style.display = "flex";
            topbarTitle.style.alignItems = "center";
            topbarTitle.style.justifyContent = "flex-start";
            topbarTitle.style.gap = "12px";
            topbarTitle.style.textAlign = "left";
        }

        try {
            const sessionResponse = await fetch("/api/session", { headers: { "Content-Type": "application/json" }, cache: "no-store" });
            if (!sessionResponse.ok) return;
            const sessionResult = await sessionResponse.json();
            const user = sessionResult?.user || {};
            const roleCode = String(user?.role?.code || "").trim().toUpperCase();
            if (roleCode === "SUPER_ADMIN" || roleCode === "SUPER ADMIN") return;

            const response = await fetch("/api/workshop/current", { headers: { "Content-Type": "application/json" }, cache: "no-store" });
            if (!response.ok) return;
            const result = await response.json();
            const workshop = result?.data || {};
            const workshopName = String(workshop?.name || user?.workshop_name || "MyWorkshop").trim();
            const workshopAddress = String(workshop?.address || "").trim();
            const workshopLogo = String(workshop?.logo_data_square || workshop?.logo_data || "").trim();

            nameEl.textContent = workshopName || "MyWorkshop";
            addressEl.textContent = workshopAddress || "Alamat Bengkel";

            if (logoEl && logoWrap && workshopLogo) {
                logoEl.src = workshopLogo;
                logoEl.onerror = () => { logoWrap.style.display = "none"; };
                logoWrap.style.display = "flex";
            } else if (logoWrap) {
                logoWrap.style.display = "none";
            }

            const identityEl = document.getElementById("dashboardWorkshopIdentity");
            if (identityEl) identityEl.textContent = workshopName ? "Bengkel: " + workshopName : "Bengkel: -";
        } catch (error) {
            console.warn("[Dashboard] gagal memuat identitas bengkel:", error);
        }
    }

    function startDashboardStatus() {
        startDashboardWelcomeClock();
        loadDashboardWorkshopIdentity();
        loadDashboardBillingSummary();
        refreshDashboardStatus().catch(error => {
            console.error("[Dashboard] gagal menghitung Status Order:", error);
        });
    }

    // Aman baik jika script dijalankan sebelum maupun sesudah DOM siap.
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", startDashboardStatus, { once: true });
    } else {
        startDashboardStatus();
    }

    // Perbarui ketika kembali ke Dashboard atau ada perubahan localStorage.
    window.addEventListener("focus", startDashboardStatus);
    document.addEventListener("visibilitychange", () => {
        if (!document.hidden) startDashboardStatus();
    });
    // Polling ringan agar status Check In Again dari API langsung diperbarui
    // walaupun Dashboard tetap terbuka setelah proses di halaman WO.
    setInterval(startDashboardStatus, 5000);


    window.refreshDashboardStatus = refreshDashboardStatus;
})();
