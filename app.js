// ================= KONFIGURASI =================
// GANTI dengan URL Web App Apps Script proyek SiapLulus (Sheet BARU, lihat code.gs).
const urlScript = "https://script.google.com/macros/s/AKfycbwNETkCgShP8QP_DR93yoVx2z6PILsZzoyxM5yLEgg8UU1Kmd_YM0TBDU8SR3IJmCg/exec";
// Password admin TIDAK disimpan di sini — divalidasi di server (Apps Script)
// lewat Script Properties (ADMIN_PASSWORD = BRIGHT), supaya tidak terlihat dari Source Code.

// ================= BANK SOAL (fetch dinamis dari Google Sheets tab "Bank Soal") =================
// quizDataByMarker[markerIndex] = array soal untuk marker itu (3 soal per marker, 8 marker).
let quizDataByMarker = {}; // { 0: [soal1, soal2, soal3], 1: [...], ... }
let quizDataFlat = []; // seluruh soal digabung jadi satu array urut
let markerRanges = {}; // { 0: {start:0,end:3}, 1: {start:3,end:6}, ... }
let soalSudahDimuat = false;

function loadSoalFromServer() {
    return fetch(urlScript + '?' + new URLSearchParams({ action: 'getSoal' }).toString())
        .then(r => {
            if (!r.ok) throw new Error('Status: ' + r.status);
            return r.json();
        })
        .then(data => {
            if (data.result !== 'success') throw new Error(data.message || 'Gagal memuat soal');

            quizDataByMarker = {};
            quizDataFlat = [];
            markerRanges = {};

            data.data.forEach(soal => {
                const soalObj = {
                    marker: soal.marker,
                    dimensi: soal.dimensi,
                    question: soal.pertanyaan,
                    options: soal.opsi.map(o => ({ key: o.key, text: o.text, score: o.skor })),
                    rekomendasiRendah: soal.rekomendasi,
                };
                if (!quizDataByMarker[soal.marker]) quizDataByMarker[soal.marker] = [];
                quizDataByMarker[soal.marker].push(soalObj);
            });

            Object.keys(quizDataByMarker).map(Number).sort((a, b) => a - b).forEach(marker => {
                const start = quizDataFlat.length;
                quizDataByMarker[marker].forEach(soalObj => quizDataFlat.push(soalObj));
                markerRanges[marker] = { start, end: quizDataFlat.length };
            });

            soalSudahDimuat = true;
            return true;
        });
}

let currentFlatIndex = 0; // pointer ke soal yang sedang ditampilkan, dalam quizDataFlat
let userAnswersFlat = []; // array sepanjang quizDataFlat: null atau {dimensi, soal, jawabanText, skor, rekomendasiRendah}
let markerTriggered = []; // array 8 boolean: true kalau audio marker itu sudah pernah diputar
let rekomendasiCache = []; // {dimensi, skor, teks} per soal
let chatAktifUntuk = null; // index soal yang sedang dibahas di jendela chat AI

// ================= LOGIN =================
function loginAdmin() {
    const pass = document.getElementById('adminPassword').value;
    if (!pass) {
        alert('Masukkan password admin.');
        return;
    }

    const btn = document.querySelector('#admin-login-screen button[onclick="loginAdmin()"]');
    if (btn) { btn.disabled = true; btn.textContent = 'Memeriksa...'; }

    const params = new URLSearchParams();
    params.append('action', 'validateAdmin');
    params.append('password', pass);

    fetch(urlScript, { method: 'POST', body: params })
        .then(r => {
            if (!r.ok) throw new Error('Status: ' + r.status);
            return r.json();
        })
        .then(data => {
            if (data.result === 'success') {
                sessionStorage.setItem('admin_password', pass);
                document.getElementById('adminPassword').value = '';
                switchScreen('admin-menu-screen');
            } else {
                alert(data.message || 'Password admin salah.');
            }
        })
        .catch(err => {
            console.error(err);
            alert('Gagal memeriksa password. Cek koneksi internet.');
        })
        .finally(() => {
            if (btn) { btn.disabled = false; btn.textContent = 'Login'; }
        });
}

function logoutAdmin() {
    sessionStorage.removeItem('admin_password');
    switchScreen('login-screen');
}

function bukaDatabase() {
    window.open('https://docs.google.com/spreadsheets/d/1007JXOa5VQsDUmBcwq4jdGiF8IHvXWqdlWAEehCHPyM/edit?usp=sharing', '_blank');
}

// ================= DATA DIRI (disimpan di sessionStorage) =================
function simpanDataDiri() {
    const nama = document.getElementById('dataNama').value.trim();
    const kelas = document.getElementById('dataKelas').value.trim();
    const jurusan = document.getElementById('dataJurusan').value.trim();
    const sekolah = document.getElementById('dataSekolah').value.trim();

    if (!nama || !kelas || !jurusan || !sekolah) {
        alert('Mohon lengkapi seluruh data diri.');
        return;
    }

    sessionStorage.setItem('siswa_nama', nama);
    sessionStorage.setItem('siswa_kelas', kelas);
    sessionStorage.setItem('siswa_jurusan', jurusan);
    sessionStorage.setItem('siswa_sekolah', sekolah);

    updateSapaanDashboard(nama);
    switchScreen('main-menu');
}

function getSiswaData() {
    return {
        nama: sessionStorage.getItem('siswa_nama') || '',
        kelas: sessionStorage.getItem('siswa_kelas') || '',
        jurusan: sessionStorage.getItem('siswa_jurusan') || '',
        sekolah: sessionStorage.getItem('siswa_sekolah') || '',
    };
}

function logoutSiswa() {
    sessionStorage.removeItem('siswa_nama');
    sessionStorage.removeItem('siswa_kelas');
    sessionStorage.removeItem('siswa_jurusan');
    sessionStorage.removeItem('siswa_sekolah');
    hapusProgresAssesmen();
    sessionStorage.removeItem('hasil_terakhir');
    switchScreen('login-screen');
}

function updateSapaanDashboard(nama) {
    const sapaanEl = document.getElementById('sapaanSiswa');
    if (sapaanEl) sapaanEl.textContent = `Halo, ${nama}!`;
    const avatarEl = document.getElementById('avatarInisial');
    if (avatarEl) avatarEl.textContent = (nama.trim().charAt(0) || 'S').toUpperCase();
    updateDashboardProgressCard();
}

function updateDashboardProgressCard() {
    const labelEl = document.getElementById('dashboardProgressLabel');
    const fillEl = document.getElementById('dashboardProgressFill');
    if (!labelEl || !fillEl) return;

    let markerSelesai = 0;
    if (markerTriggered && markerRanges && Object.keys(markerRanges).length) {
        for (let i = 0; i < 8; i++) {
            const range = markerRanges[i];
            if (!range) continue;
            let semuaTerjawab = true;
            for (let idx = range.start; idx < range.end; idx++) {
                if (!userAnswersFlat[idx]) { semuaTerjawab = false; break; }
            }
            if (semuaTerjawab) markerSelesai++;
        }
    } else {
        const savedProgress = sessionStorage.getItem('assesmen_progress');
        if (savedProgress) {
            try {
                const parsed = JSON.parse(savedProgress);
                markerSelesai = (parsed.markerTriggered || []).filter(Boolean).length;
            } catch (e) {}
        }
    }

    labelEl.textContent = `${markerSelesai}/8 marker`;
    fillEl.style.width = `${(markerSelesai / 8) * 100}%`;
}
function switchScreen(screenId) {
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const target = document.getElementById(screenId);
    if (target) target.classList.add('active');
    else console.error('Layar tidak ditemukan:', screenId);
    if (screenId === 'main-menu') updateDashboardProgressCard();
}

// ================= INJEKSI LAZY <a-scene> (baru dimasukkan ke DOM saat
// "Mulai Asesmen" diklik, supaya 8 model .glb (~30MB) TIDAK ikut terdownload
// saat halaman pertama kali dibuka) =================
let arSceneSudahDisuntik = false;

function buildArSceneHtml() {
    const modelFiles = [
        '1__Keimanan_dan_Ketakwaan_final.glb',
        '2__Kewargaan_final.glb',
        '3__Penalaran_Kritis_final.glb',
        '4__Kreatifitas_final.glb',
        '5__Kolaborasi_final.glb',
        '6__kemandirian_final.glb',
        '7__Kesehatan_final.glb',
        '8__Komunikasi_final.glb',
    ];

    const audioTags = Array.from({ length: 8 }, (_, i) =>
        `<audio id="assess-audio-${i}" src="soal${i + 1}.mp3" preload="none"></audio>`
    ).join('\n                ');

    const assetItems = modelFiles.map((f, i) =>
        `<a-asset-item id="model-${i}" src="${f}"></a-asset-item>`
    ).join('\n                ');

    const targets = modelFiles.map((_, i) => `
            <a-entity id="target-${i}" mindar-image-target="targetIndex: ${i}">
                <a-gltf-model class="ar-3d-placeholder" src="#model-${i}" position="0 0 0" scale="0.00125 0.00125 0.00125" animation="property: rotation; to: 0 360 0; loop: true; dur: 8000; easing: linear"></a-gltf-model>
            </a-entity>`).join('');

    return `
        <a-scene
            id="ar-scene"
            mindar-image="imageTargetSrc: mind1.mind; uiLoading: no; uiError: no; uiScanning: no; autoStart: false; filterMinCF: 0.0001; filterBeta: 0.001; warmupTolerance: 2; missTolerance: 5;"
            loading-screen="enabled: false"
            vr-mode-ui="enabled: false"
            device-orientation-permission-ui="enabled: false"
            renderer="colorManagement: true;">

            <a-assets timeout="20000">
                ${audioTags}
                ${assetItems}
            </a-assets>
            <a-camera position="0 0 0" look-controls="enabled: false"></a-camera>
            ${targets}
        </a-scene>
    `;
}

function injectArSceneIfNeeded() {
    if (arSceneSudahDisuntik) return;
    const slot = document.getElementById('ar-scene-slot');
    if (!slot) return;
    slot.innerHTML = buildArSceneHtml();
    arSceneSudahDisuntik = true;
    initArMarkerListeners();
    initArAudioDebugListeners();
}

// Listener marker (targetFound/targetLost) — dipindah dari DOMContentLoaded ke
// sini karena elemen #target-0..7 baru ADA setelah injectArSceneIfNeeded()
// dipanggil, tidak lagi tersedia sejak awal load halaman.
function initArMarkerListeners() {
    const scanHint = document.getElementById('scan-hint');

    const isMarkerLengkapTerjawab = (marker) => {
        const range = markerRanges[marker];
        if (!range) return false;
        for (let idx = range.start; idx < range.end; idx++) {
            if (userAnswersFlat[idx] === null) return false;
        }
        return true;
    };

    for (let i = 0; i < 8; i++) {
        const targetEl = document.querySelector('#target-' + i);
        if (!targetEl) continue;

        const modelEl = targetEl.querySelector('a-gltf-model');
        if (modelEl) {
            modelEl.addEventListener('model-loaded', (e) => {
                console.log(`[MODEL ${i}] BERHASIL dimuat (model-loaded)`, modelEl.getAttribute('src'));
                try {
                    const mesh = e.detail.model;
                    mesh.updateMatrixWorld(true); // paksa hitung ulang matrix dulu, supaya bounding box tidak NaN
                    const box = new THREE.Box3().setFromObject(mesh);
                    const size = new THREE.Vector3();
                    box.getSize(size);
                    const center = new THREE.Vector3();
                    box.getCenter(center);
                    console.log(`[MODEL ${i}] Ukuran bounding box asli:`, size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3),
                        '| Center:', center.x.toFixed(3), center.y.toFixed(3), center.z.toFixed(3));
                    console.log(`[MODEL ${i}] scale entity saat ini:`, modelEl.object3D.scale.x, modelEl.object3D.scale.y, modelEl.object3D.scale.z);
                    console.log(`[MODEL ${i}] visible?`, modelEl.object3D.visible, '| parent visible?', modelEl.object3D.parent ? modelEl.object3D.parent.visible : 'no parent');
                } catch (boxErr) {
                    console.error(`[MODEL ${i}] Gagal hitung bounding box:`, boxErr);
                }
            });
            modelEl.addEventListener('model-error', (e) => {
                console.error(`[MODEL ${i}] GAGAL dimuat (model-error)`, modelEl.getAttribute('src'), e.detail);
            });
        }

        targetEl.addEventListener('targetFound', () => {
            if (scanHint) scanHint.textContent = `Marker ${i + 1} terdeteksi! Tekan "Next" untuk menjawab.`;

            // Diagnostik: cek visibilitas & ukuran model TEPAT saat marker
            // terdeteksi (bukan cuma saat model selesai loading di awal) —
            // ini momen paling relevan karena di sinilah model SEHARUSNYA
            // benar-benar terlihat menempel di kartu marker.
            if (modelEl && modelEl.object3D) {
                const obj = modelEl.object3D;
                obj.updateMatrixWorld(true);
                const box = new THREE.Box3().setFromObject(obj);
                const size = new THREE.Vector3();
                box.getSize(size);
                console.log(`[MODEL ${i}] SAAT TARGET FOUND — visible:`, obj.visible,
                    '| world scale:', obj.getWorldScale(new THREE.Vector3()),
                    '| world position:', obj.getWorldPosition(new THREE.Vector3()),
                    '| bounding box size:', size.x.toFixed(3), size.y.toFixed(3), size.z.toFixed(3));
                console.log(`[MODEL ${i}] parent (target-${i}) entity visible:`, targetEl.object3D.visible,
                    '| parent world scale:', targetEl.object3D.getWorldScale(new THREE.Vector3()));

                // Cek susulan beberapa kali — kalau-kalau MindAR baru MENGANIMASIKAN
                // scale dari 0 ke 1 secara bertahap (bukan instan), jadi baru kelihatan
                // beberapa ratus ms setelah targetFound, bukan tepat di momen event ini.
                // PENTING: cek scale GABUNGAN model itu sendiri (parent x local), bukan
                // cuma parent saja — itu yang benar-benar menentukan ukuran tampilan akhir.
                [200, 500, 1000, 2000].forEach(delay => {
                    setTimeout(() => {
                        obj.updateMatrixWorld(true);
                        const worldScale = obj.getWorldScale(new THREE.Vector3());
                        const worldPos = obj.getWorldPosition(new THREE.Vector3());
                        const boxNow = new THREE.Box3().setFromObject(obj);
                        const sizeNow = new THREE.Vector3();
                        boxNow.getSize(sizeNow);
                        console.log(`[MODEL ${i}] +${delay}ms MODEL (gabungan) — world scale:`,
                            worldScale.x.toFixed(6), worldScale.y.toFixed(6), worldScale.z.toFixed(6),
                            '| world position:', worldPos.x.toFixed(3), worldPos.y.toFixed(3), worldPos.z.toFixed(3),
                            '| bbox tampil:', sizeNow.x.toFixed(3), sizeNow.y.toFixed(3), sizeNow.z.toFixed(3));

                        // Cek juga posisi & clipping plane kamera, untuk pastikan model
                        // tidak "terpotong" karena terlalu dekat/jauh dari kamera.
                        const camEl = document.querySelector('#ar-scene [camera]') || document.querySelector('a-camera');
                        if (camEl && camEl.getObject3D && camEl.getObject3D('camera')) {
                            const cam = camEl.getObject3D('camera');
                            const camPos = cam.getWorldPosition(new THREE.Vector3());
                            const distance = camPos.distanceTo(worldPos);
                            console.log(`[MODEL ${i}] +${delay}ms kamera — near:`, cam.near, 'far:', cam.far,
                                '| posisi kamera:', camPos.x.toFixed(3), camPos.y.toFixed(3), camPos.z.toFixed(3),
                                '| jarak kamera ke model:', distance.toFixed(3));
                        }
                    }, delay);
                });
            }

            if (!markerTriggered[i] && !isMarkerLengkapTerjawab(i)) {
                playAudioForTarget(i);
            } else if (!isMarkerLengkapTerjawab(i)) {
                tampilkanTombolNextAR(i);
            }
        });

        targetEl.addEventListener('targetLost', () => {
            if (scanHint) scanHint.textContent = 'Arahkan kamera ke salah satu kartu marker (1-8)...';
            // CATATAN: tombol Next SENGAJA TIDAK disembunyikan lagi di sini.
            // Sebelumnya, kalau marker sempat "hilang" sesaat dari pandangan
            // kamera (tangan/HP bergerak sedikit saat audio masih diputar),
            // tombol Next ikut hilang dan siswa jadi tidak bisa lanjut ke
            // pertanyaan meski marker itu sudah sempat ter-trigger. Begitu
            // sebuah marker sudah pernah trigger (markerTriggered[i]=true)
            // dan belum terjawab, tombol Next tetap harus tersedia terlepas
            // dari status tracking kamera saat itu.
            if (!markerTriggered[i] && !isMarkerLengkapTerjawab(i)) {
                const a = document.getElementById('assess-audio-' + i);
                if (a) a.pause();
            }
        });
    }
}

function initArAudioDebugListeners() {
    for (let i = 0; i < 8; i++) {
        const a = document.getElementById('assess-audio-' + i);
        if (!a) continue;
        a.addEventListener('error', () => {
            const err = a.error;
            console.error(`[AUDIO ${i}] ERROR code=${err ? err.code : '?'} message=${err ? err.message : '(tidak ada detail)'}`);
        });
        a.addEventListener('canplay', () => console.log(`[AUDIO ${i}] siap diputar (canplay)`));
        a.addEventListener('playing', () => console.log(`[AUDIO ${i}] MULAI BERMAIN (playing)`));
        a.addEventListener('ended', () => console.log(`[AUDIO ${i}] SELESAI (ended)`));
    }
}

function getArSystem() {
    const sceneEl = document.querySelector('#ar-scene');
    if (!sceneEl || !sceneEl.systems) return null;
    return sceneEl.systems['mindar-image-system'] || null;
}

// ================= MULAI ASESMEN =================
function setArLoadingText(mainText, subText) {
    const t = document.getElementById('arLoadingText');
    const s = document.getElementById('arLoadingSubtext');
    if (t && mainText) t.textContent = mainText;
    if (s && subText !== undefined) s.textContent = subText;
}

function showArLoadingOverlay() {
    console.log('[AR-DEBUG] showArLoadingOverlay() dipanggil');
    const overlay = document.getElementById('ar-loading-overlay');
    if (overlay) overlay.classList.remove('ar-loading-hidden');
}

function hideArLoadingOverlay() {
    console.log('[AR-DEBUG] hideArLoadingOverlay() dipanggil dari:', new Error().stack);
    const overlay = document.getElementById('ar-loading-overlay');
    if (overlay) overlay.classList.add('ar-loading-hidden');
}

// Menunggu video kamera BENAR-BENAR mengalirkan gambar (bukan cuma menunggu
// sys.start() selesai dipanggil) sebelum menutup overlay loading. sys.start()
// hanya MEMINTA izin kamera (getUserMedia) — antara itu dipanggil sampai video
// sungguhan tampil (termasuk waktu pengguna menekan "Izinkan" di dialog kamera)
// bisa makan waktu lebih dari sekejap, dan sebelumnya overlay ditutup terlalu
// cepat (fixed delay) sehingga sempat menampakkan canvas AR yang masih putih
// kosong di baliknya.
function waitForCameraVideoThenHideOverlay() {
    setArLoadingText('Membuka kamera...', 'Mohon izinkan akses kamera saat diminta');
    console.log('[AR-DEBUG] waitForCameraVideoThenHideOverlay() mulai');

    const scanHint = document.getElementById('scan-hint');
    const startTime = Date.now();
    const MAX_WAIT_MS = 15000; // batas pengaman: 15 detik
    let sudahSelesai = false;
    let jumlahCek = 0;

    const selesaikan = (berhasil, alasan) => {
        if (sudahSelesai) {
            console.log('[AR-DEBUG] selesaikan() dipanggil lagi tapi sudahSelesai=true, diabaikan. alasan:', alasan);
            return;
        }
        sudahSelesai = true;
        console.log('[AR-DEBUG] selesaikan() FIRE. berhasil=', berhasil, 'alasan=', alasan, 'setelah', Date.now() - startTime, 'ms,', jumlahCek, 'kali cek');

        // Cek ukuran canvas TEPAT saat video terkonfirmasi aktif. HANYA panggil
        // resize() kalau memang terbukti canvas-nya 0 di titik ini — supaya tidak
        // mengulang kesalahan sebelumnya (resize yang dipanggil di waktu yang salah
        // justru bisa MERUSAK canvas yang sebenarnya sudah berukuran benar).
        const sceneElNow = document.querySelector('#ar-scene');
        if (sceneElNow) {
            const canvasEl = sceneElNow.querySelector('canvas.a-canvas');
            const wSebelum = canvasEl ? canvasEl.width : null;
            const hSebelum = canvasEl ? canvasEl.height : null;
            console.log('[AR-DEBUG] canvas saat selesaikan() SEBELUM cek:', wSebelum, 'x', hSebelum);

            if (canvasEl && (canvasEl.width === 0 || canvasEl.height === 0)) {
                console.log('[AR-DEBUG] canvas terbukti 0, coba sceneEl.resize() dulu...');
                if (typeof sceneElNow.resize === 'function') sceneElNow.resize();
                window.dispatchEvent(new Event('resize'));
                console.log('[AR-DEBUG] canvas SESUDAH sceneEl.resize():', canvasEl.width, 'x', canvasEl.height);

                // sceneEl.resize() terbukti kadang tidak mempan. Kalau masih 0,
                // langsung akses THREE.js renderer-nya dan paksa setSize() manual
                // (melewati resize() bawaan A-Frame yang tidak bisa diandalkan).
                if (canvasEl.width === 0 || canvasEl.height === 0) {
                    console.log('[AR-DEBUG] masih 0, coba akses sceneElNow.renderer langsung...');
                    const renderer = sceneElNow.renderer;
                    console.log('[AR-DEBUG] sceneElNow.renderer ada?', !!renderer);
                    if (renderer && typeof renderer.setSize === 'function') {
                        const w = window.innerWidth;
                        const h = window.innerHeight;
                        renderer.setSize(w, h, true);
                        console.log('[AR-DEBUG] canvas SESUDAH renderer.setSize(' + w + ',' + h + '):', canvasEl.width, 'x', canvasEl.height);
                    } else {
                        // Jaring pengaman terakhir: set atribut width/height canvas
                        // secara manual langsung, kalau renderer THREE.js pun tidak
                        // bisa diakses untuk alasan apa pun.
                        const w = window.innerWidth;
                        const h = window.innerHeight;
                        const dpr = window.devicePixelRatio || 1;
                        canvasEl.width = w * dpr;
                        canvasEl.height = h * dpr;
                        canvasEl.style.width = w + 'px';
                        canvasEl.style.height = h + 'px';
                        console.log('[AR-DEBUG] canvas SESUDAH set manual width/height:', canvasEl.width, 'x', canvasEl.height);
                    }
                }
            } else {
                console.log('[AR-DEBUG] canvas sudah punya ukuran valid, TIDAK perlu resize.');
            }

            // FIX BARU: elemen <video> (sumber gambar kamera) konsisten berukuran
            // 0x0 (style inline width/height:0px) di setiap pengecekan sebelumnya.
            // Kalau canvas ternyata TRANSPARAN (bukan menggambar video sebagai
            // tekstur, melainkan video tampil langsung lewat DOM biasa di belakang
            // canvas), video 0x0 = tidak ada apa pun yang bisa terlihat sama sekali,
            // walau data video-nya sendiri sudah "siap". Paksa video full-screen.
            const videoElNow = sceneElNow.querySelector('video') || document.querySelector('#ar-screen video');
            if (videoElNow) {
                console.log('[AR-DEBUG] video style SEBELUM dipaksa:', videoElNow.style.width, videoElNow.style.height, videoElNow.style.zIndex);
                videoElNow.style.width = '100vw';
                videoElNow.style.height = '100vh';
                videoElNow.style.objectFit = 'cover';
                console.log('[AR-DEBUG] video style SESUDAH dipaksa:', videoElNow.style.width, videoElNow.style.height);
                console.log('[AR-DEBUG] video.videoWidth asli (resolusi native kamera):', videoElNow.videoWidth, 'x', videoElNow.videoHeight);
            } else {
                console.log('[AR-DEBUG] videoElNow tidak ditemukan saat selesaikan().');
            }

            // Cek susulan 500ms kemudian — kalau-kalau ada proses lain (mis. MindAR
            // sendiri) yang menimpa balik ukuran canvas jadi 0 setelah kita perbaiki.
            setTimeout(() => {
                console.log('[AR-DEBUG] cek susulan 500ms setelah selesaikan(): canvas =',
                    canvasEl.width, 'x', canvasEl.height);

                // Diagnostik BARU: pastikan render loop THREE.js benar-benar
                // jalan terus-menerus (bukan cuma sekali gambar lalu berhenti).
                // Kalau frame counter TIDAK bertambah, artinya render loop macet
                // meski canvas sudah berukuran benar — video kamera tidak akan
                // pernah ter-update ke layar walau semuanya "siap" secara teknis.
                const renderer = sceneElNow.renderer;
                if (renderer && renderer.info && renderer.info.render) {
                    const frame0 = renderer.info.render.frame;
                    console.log('[AR-DEBUG] renderer.info.render.frame saat ini:', frame0);
                    setTimeout(() => {
                        const frame1 = renderer.info.render.frame;
                        console.log('[AR-DEBUG] renderer.info.render.frame setelah 1 detik:', frame1,
                            '(bertambah', frame1 - frame0, 'frame). Kalau 0, render loop MACET.');
                    }, 1000);
                } else {
                    console.log('[AR-DEBUG] tidak bisa akses renderer.info.render untuk cek frame counter.');
                }
            }, 500);
        }

        hideArLoadingOverlay();
        if (berhasil) {
            if (scanHint) scanHint.textContent = 'Arahkan kamera ke salah satu kartu marker (1-8)...';
        } else {
            if (scanHint) scanHint.textContent = 'Kamera tidak merespons. Cek izin kamera di pengaturan browser, lalu coba lagi.';
            console.error('[AR] Timeout menunggu video kamera aktif setelah', MAX_WAIT_MS, 'ms.');
        }
    };

    const cekVideo = () => {
        if (sudahSelesai) return;
        jumlahCek++;

        const videoEl = document.querySelector('#ar-screen video');
        console.log('[AR-DEBUG] cekVideo() #' + jumlahCek, {
            videoAda: !!videoEl,
            readyState: videoEl ? videoEl.readyState : null,
            paused: videoEl ? videoEl.paused : null,
            videoWidth: videoEl ? videoEl.videoWidth : null,
            videoHeight: videoEl ? videoEl.videoHeight : null,
            elapsedMs: Date.now() - startTime,
        });

        if (videoEl) {
            // Kalau video sudah punya frame nyata (readyState >= 2 = HAVE_CURRENT_DATA)
            // pada saat kita cek, langsung selesai. Kalau belum, tunggu event 'playing'.
            if (videoEl.readyState >= 2 && !videoEl.paused) {
                selesaikan(true, 'readyState>=2 saat polling ke-' + jumlahCek);
                return;
            }
            if (!videoEl.dataset.arListenerAttached) {
                videoEl.dataset.arListenerAttached = '1';
                videoEl.addEventListener('playing', () => selesaikan(true, "event 'playing'"), { once: true });
                videoEl.addEventListener('loadeddata', () => {
                    console.log('[AR-DEBUG] event loadeddata fired, readyState=', videoEl.readyState);
                    if (videoEl.readyState >= 2) selesaikan(true, "event 'loadeddata' + readyState>=2");
                }, { once: true });
            }
        }

        if (Date.now() - startTime >= MAX_WAIT_MS) {
            selesaikan(false, 'timeout ' + MAX_WAIT_MS + 'ms tercapai');
            return;
        }

        setTimeout(cekVideo, 200);
    };

    cekVideo();
}

function mulaiAssesmen() {
    const siswa = getSiswaData();
    if (!siswa.nama) {
        alert('Data diri belum lengkap. Silakan login ulang.');
        switchScreen('login-screen');
        return;
    }

    switchScreen('ar-screen');
    showArLoadingOverlay();
    setArLoadingText('Menyiapkan asesmen...', 'Memuat data soal dari server');

    loadSoalFromServer()
        .then(() => {
            const savedProgress = sessionStorage.getItem('assesmen_progress');
            if (savedProgress) {
                const parsed = JSON.parse(savedProgress);
                userAnswersFlat = parsed.userAnswersFlat;
                markerTriggered = parsed.markerTriggered;
            } else {
                userAnswersFlat = new Array(quizDataFlat.length).fill(null);
                markerTriggered = new Array(8).fill(false);
            }

            updateProgressHint();
            setArLoadingText('Menyiapkan asesmen...', 'Memuat model 3D & audio (0/16)...');

            injectArSceneIfNeeded();

            const sceneEl = document.querySelector('#ar-scene');
            sceneEl.style.display = '';

            // Pantau progres <a-assets> (16 item: 8 model .glb + 8 audio) supaya
            // siswa lihat progres nyata, bukan cuma teks statis tanpa kepastian.
            const assetsEl = sceneEl.querySelector('a-assets');
            if (assetsEl) {
                assetsEl.addEventListener('progress', (e) => {
                    const loaded = e.detail && e.detail.loadedCount != null ? e.detail.loadedCount : '?';
                    const total = e.detail && e.detail.totalCount != null ? e.detail.totalCount : 16;
                    setArLoadingText('Menyiapkan asesmen...', `Memuat model 3D & audio (${loaded}/${total})...`);
                });
                assetsEl.addEventListener('timeout', () => {
                    console.warn('[AR] Sebagian aset melebihi batas waktu, tapi tetap dilanjutkan.');
                });
            }

            // PENTING: kamera BARU diminta (lewat sys.start()) SETELAH event 'loaded'
            // resmi dari A-Frame — menandakan scene + SEMUA <a-assets> (model 3D +
            // audio) benar-benar selesai diproses. Overlay loading di atas menutupi
            // layar sepenuhnya selama ini, sehingga siswa tidak melihat layar
            // putih/kosong saat proses download+decode berlangsung.
            const startWhenReady = () => {
                console.log('[AR-DEBUG] startWhenReady() dipanggil. sceneEl.hasLoaded=', sceneEl.hasLoaded);
                setArLoadingText('Membuka kamera...', 'Mohon izinkan akses kamera saat diminta');
                const sys = getArSystem();
                console.log('[AR-DEBUG] getArSystem() ->', sys);
                if (sys) {
                    try {
                        console.log('[AR-DEBUG] memanggil sys.start()...');
                        sys.start();
                        console.log('[AR-DEBUG] sys.start() selesai dipanggil (async internal jalan di background)');

                        // CATATAN: sebelumnya di sini ada pemanggilan resize() paksa
                        // segera setelah start() — TERBUKTI JUSTRU MERUSAK. Canvas
                        // sempat sudah berukuran benar (mis. 450x225) secara alami,
                        // tapi resize() yang dipanggil TERLALU DINI (sebelum video
                        // tahu resolusi aslinya, readyState masih 0) membuat A-Frame
                        // menghitung ulang berdasarkan info video yang belum ada,
                        // hasilnya 0x0. Resize (kalau memang perlu) sekarang HANYA
                        // dilakukan di dalam selesaikan() — lihat waitForCameraVideoThenHideOverlay()
                        // — yaitu tepat setelah video benar-benar siap (readyState>=2),
                        // dan HANYA kalau canvas terbukti masih 0 saat itu.

                        waitForCameraVideoThenHideOverlay();
                    } catch (startErr) {
                        console.error('Gagal memulai kamera AR:', startErr);
                        setArLoadingText('Gagal memulai kamera', 'Coba refresh halaman, lalu ulangi.');
                    }
                } else {
                    console.error('Sistem mindar-image-system tidak ditemukan setelah scene loaded.');
                    setArLoadingText('Gagal memuat AR', 'Coba refresh halaman, lalu ulangi.');
                }
            };

            console.log('[AR-DEBUG] sebelum cek hasLoaded. sceneEl.hasLoaded=', sceneEl.hasLoaded);
            if (sceneEl.hasLoaded) {
                startWhenReady();
            } else {
                sceneEl.addEventListener('loaded', () => {
                    console.log('[AR-DEBUG] event "loaded" dari a-scene FIRE');
                    startWhenReady();
                }, { once: true });
            }
        })
        .catch(err => {
            console.error('Gagal memuat soal / memulai asesmen:', err);
            hideArLoadingOverlay();
            alert('Gagal memuat halaman asesmen. Cek koneksi internet, lalu coba lagi.');
            switchScreen('main-menu');
        });
}

function updateProgressHint() {
    const done = userAnswersFlat.filter(a => a !== null).length;
    const total = quizDataFlat.length;
    const el = document.getElementById('progress-hint');
    if (el) el.textContent = `Terjawab: ${done}/${total}`;
}

// Menghentikan & menyembunyikan SELURUH jejak kamera AR secara paksa.
function forceHideARCamera() {
    try {
        const arSystem = getArSystem();
        if (arSystem) arSystem.stop();
    } catch (err) {
        console.error('Error saat arSystem.stop():', err);
    }

    const sceneEl = document.querySelector('#ar-scene');
    if (sceneEl) sceneEl.style.display = 'none';

    const idAudioSoal = new Set(Array.from({ length: 8 }, (_, i) => 'assess-audio-' + i));
    document.querySelectorAll('video').forEach(v => {
        try { v.pause(); } catch (e) {}
        v.style.display = 'none';
    });
    document.querySelectorAll('audio').forEach(a => {
        if (!idAudioSoal.has(a.id)) return;
        try { a.pause(); } catch (e) {}
    });

    document.querySelectorAll('body > canvas').forEach(c => {
        c.style.display = 'none';
    });
}

function stopGameAndGoHome() {
    try {
        forceHideARCamera();
        for (let i = 0; i < 8; i++) {
            const a = document.getElementById('assess-audio-' + i);
            if (a) a.pause();
        }
    } catch (err) {
        console.error(err);
    } finally {
        switchScreen('main-menu');
    }
}

// ================= PER-MARKER: gambar AR 3D muncul + audio -> lalu Next mentrigger kuis =================
// Berbeda dari versi lama (video otomatis membuka kuis saat video "ended"), di sini
// model 3D langsung terlihat begitu marker terdeteksi, audio diputar, dan siswa
// SENDIRI menekan tombol "Next" (di modal kuis) kapan pun untuk mulai menjawab
// (baik audio sudah selesai maupun belum), sesuai alur yang diminta.
function playAudioForTarget(index) {
    const audio = document.getElementById('assess-audio-' + index);
    markerTriggered[index] = true; // ditandai saat marker terdeteksi & audio mulai diputar

    if (!audio) {
        console.error(`[AR] Elemen audio #assess-audio-${index} tidak ditemukan!`);
    } else {
        audio.currentTime = 0;
        audio.play()
            .then(() => console.log(`[AR] audio.play() berhasil untuk marker ${index + 1}`))
            .catch(err => console.error(`[AR] audio.play() GAGAL untuk marker ${index + 1}:`, err.name, err.message));
    }

    tampilkanTombolNextAR(index);
}

// Tombol "Next" mengambang yang muncul di layar AR setelah marker terdeteksi
// (gambar AR 3D + audio berjalan), untuk mentrigger pertanyaan (3 soal) marker tsb.
function tampilkanTombolNextAR(index) {
    const btn = document.getElementById('ar-next-btn');
    if (!btn) return;
    btn.style.display = 'block';
    btn.onclick = () => {
        btn.style.display = 'none';
        const audio = document.getElementById('assess-audio-' + index);
        if (audio) audio.pause();
        openQuiz(index);
    };
}

function openQuiz(markerIndex) {
    const range = markerRanges[markerIndex];
    if (!range) {
        console.error(`[AR] Tidak ada soal terdaftar untuk marker ${markerIndex}.`);
        return;
    }
    currentFlatIndex = range.start;
    document.getElementById('quiz-modal').style.display = 'flex';
    renderQuestion();
}

function renderQuestion() {
    const q = quizDataFlat[currentFlatIndex];
    const marker = q.marker;
    const range = markerRanges[marker];
    const nomorDalamMarker = currentFlatIndex - range.start + 1; // 1-based
    const totalDalamMarker = range.end - range.start;

    const body = document.getElementById('quiz-body');
    const nextBtn = document.getElementById('quiz-next-btn');
    document.getElementById('quiz-dimensi-label').textContent =
        `Marker ${marker + 1} — Soal ${nomorDalamMarker}/${totalDalamMarker} — ${q.dimensi}`;

    const optionsHtml = q.options.map(opt => `
        <button class="option-btn" data-key="${opt.key}" data-score="${opt.score}" onclick="selectAnswer('${opt.key}', ${opt.score})">
            <strong>${opt.key.toUpperCase()}.</strong> ${opt.text}
        </button>
    `).join('');

    body.innerHTML = `
        <p class="quiz-question">${q.question}</p>
        <div class="quiz-options">${optionsHtml}</div>
    `;

    nextBtn.style.display = 'none';
    const sisaBelumDijawab = userAnswersFlat.filter(a => a === null).length;
    nextBtn.textContent = (sisaBelumDijawab <= 1) ? 'Selesai' : 'Lanjut';
}

function selectAnswer(selectedKey, score) {
    const q = quizDataFlat[currentFlatIndex];
    const buttons = document.querySelectorAll('.option-btn');

    buttons.forEach(btn => {
        btn.classList.remove('selected');
        if (btn.dataset.key === selectedKey) btn.classList.add('selected');
    });

    const selectedOption = q.options.find(o => o.key === selectedKey);
    userAnswersFlat[currentFlatIndex] = {
        dimensi: q.dimensi,
        soal: q.question,
        jawabanText: selectedKey.toUpperCase() + '. ' + (selectedOption ? selectedOption.text : ''),
        skor: score,
        rekomendasiRendah: q.rekomendasiRendah,
    };
    markerTriggered[q.marker] = true;
    updateProgressHint();
    simpanProgresAssesmen();

    document.getElementById('quiz-next-btn').style.display = 'block';
}

function simpanProgresAssesmen() {
    sessionStorage.setItem('assesmen_progress', JSON.stringify({ userAnswersFlat, markerTriggered }));
}

function hapusProgresAssesmen() {
    sessionStorage.removeItem('assesmen_progress');
    sessionStorage.removeItem('assesmen_submission_id');
    sessionStorage.removeItem('rekomendasi_ai_cache');
}

function getOrCreateSubmissionId() {
    let id = sessionStorage.getItem('assesmen_submission_id');
    if (!id) {
        id = (crypto.randomUUID ? crypto.randomUUID() : 'sub-' + Date.now() + '-' + Math.random().toString(36).slice(2));
        sessionStorage.setItem('assesmen_submission_id', id);
    }
    return id;
}

function goToNextQuestion() {
    const q = quizDataFlat[currentFlatIndex];
    const range = markerRanges[q.marker];

    if (currentFlatIndex + 1 < range.end) {
        currentFlatIndex++;
        renderQuestion();
        return;
    }

    document.getElementById('quiz-modal').style.display = 'none';

    const belumDijawab = userAnswersFlat.filter(a => a === null).length;
    if (belumDijawab === 0) {
        finishAssessment();
    } else {
        const scanHint = document.getElementById('scan-hint');
        if (scanHint) scanHint.textContent = `Arahkan kamera ke kartu marker lain (${belumDijawab} soal tersisa)...`;
    }
}

function finishAssessment() {
    try {
        forceHideARCamera();
        for (let i = 0; i < 8; i++) {
            const a = document.getElementById('assess-audio-' + i);
            if (a) a.pause();
        }
    } catch (err) {
        console.error('Error saat menghentikan AR di finishAssessment():', err);
    }

    const total = hitungSkorSkala100();
    document.getElementById('final-total-score').textContent = total;
    document.getElementById('submit-modal').style.display = 'flex';
}

// Total mentah maksimal 120 (24 soal x skor maks 5, 3 soal x 8 marker) dikonversi ke skala 0-100
function hitungSkorSkala100() {
    const totalMentah = userAnswersFlat.reduce((sum, a) => sum + (a ? a.skor : 0), 0);
    const skorTertinggi = quizDataFlat.length * 5;
    if (skorTertinggi === 0) return 0;
    return Math.round((totalMentah / skorTertinggi) * 100);
}

// ================= KIRIM KE GOOGLE SHEETS =================
function kirimData() {
    const siswa = getSiswaData();
    const total = hitungSkorSkala100();
    const submissionId = getOrCreateSubmissionId();

    const btnKirim = document.getElementById('btn-kirim');
    btnKirim.textContent = 'Menyimpan...';
    btnKirim.disabled = true;

    const formData = new URLSearchParams();
    formData.append('Nama', siswa.nama);
    formData.append('Kelas', siswa.kelas);
    formData.append('Jurusan', siswa.jurusan);
    formData.append('Sekolah', siswa.sekolah);
    formData.append('TotalSkor', total);
    formData.append('submissionId', submissionId);

    userAnswersFlat.forEach((a, i) => {
        formData.append(`Jawaban${i + 1}`, a ? a.jawabanText : '');
        formData.append(`Skor${i + 1}`, a ? a.skor : 0);
    });

    sessionStorage.setItem('hasil_terakhir', JSON.stringify({ total, jawaban: userAnswersFlat }));

    fetch(urlScript, { method: 'POST', body: formData })
        .then(response => {
            if (!response.ok) throw new Error('Status: ' + response.status);
            return response.json();
        })
        .then(() => {
            hapusProgresAssesmen();
            document.getElementById('submit-modal').style.display = 'none';
            document.getElementById('submit-success-modal').style.display = 'flex';
            btnKirim.textContent = 'Kirim & Selesai';
            btnKirim.disabled = false;
        })
        .catch(error => {
            console.error('Error:', error);
            alert('Gagal mengirim data. Pastikan koneksi internet stabil.');
            btnKirim.textContent = 'Kirim & Selesai';
            btnKirim.disabled = false;
        });
}

function backToMenuAfterSubmit() {
    forceHideARCamera();
    document.getElementById('submit-success-modal').style.display = 'none';
    switchScreen('main-menu');
}

// ================= HASIL ASESMEN =================
function enrichJawabanRingkas(data) {
    if (!data.jawaban) return data;
    data.jawaban = data.jawaban.map((a, i) => {
        const soalRef = quizDataFlat[i];
        return {
            dimensi: soalRef ? soalRef.dimensi : '(soal tidak ditemukan)',
            soal: soalRef ? soalRef.question : '(pertanyaan tidak ditemukan, mungkin sudah dihapus admin)',
            jawabanText: a ? a.jawabanText : '-',
            skor: a ? a.skor : 0,
            rekomendasiRendah: soalRef ? soalRef.rekomendasiRendah : 'Tidak ada rekomendasi tersedia.',
        };
    });
    return data;
}

function bukaHasilAssesmen() {
    switchScreen('hasil-screen');
    const body = document.getElementById('hasil-body');
    body.innerHTML = 'Memuat data...';

    const cached = sessionStorage.getItem('hasil_terakhir');
    if (cached) {
        renderHasil(JSON.parse(cached));
        return;
    }

    const siswa = getSiswaData();
    const params = new URLSearchParams({ action: 'hasil', nama: siswa.nama, kelas: siswa.kelas, sekolah: siswa.sekolah });

    const pastikanSoalTerload = soalSudahDimuat ? Promise.resolve() : loadSoalFromServer();

    pastikanSoalTerload
        .then(() => fetch(urlScript + '?' + params.toString()))
        .then(r => {
            if (!r.ok) throw new Error('Status: ' + r.status);
            return r.json();
        })
        .then(data => {
            if (!data || data.result === 'not_found') {
                body.innerHTML = '<p>Belum ada data asesmen untuk siswa ini. Silakan lakukan Mulai Asesmen terlebih dahulu.</p>';
                return;
            }
            data = enrichJawabanRingkas(data);
            sessionStorage.setItem('hasil_terakhir', JSON.stringify(data));
            renderHasil(data);
        })
        .catch(err => {
            console.error(err);
            body.innerHTML = '<p>Gagal memuat data hasil asesmen. Coba lagi nanti.</p>';
        });
}

function renderHasil(data) {
    const body = document.getElementById('hasil-body');
    let html = '';
    data.jawaban.forEach((a, i) => {
        html += `
            <div style="margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #48cae4;">
                <p style="margin:0 0 4px 0; color:#48cae4; font-size:13px;">Soal ${i + 1} — ${a.dimensi}</p>
                <p style="margin:0 0 6px 0; font-size:14px;">${a.soal}</p>
                <p style="margin:0; font-size:14px;"><strong>Jawaban:</strong> ${a.jawabanText}</p>
                <p style="margin:0; font-size:14px;"><strong>Skor:</strong> ${a.skor}</p>
            </div>
        `;
    });
    html += `<p style="text-align:center; font-size:18px; font-weight:700; color:#90CAF9;">Total Skor: ${data.total} / 100</p>`;
    body.innerHTML = html;
}

// ================= REKOMENDASI HASIL ASESMEN =================
function cobaLagiRekomendasi() {
    if (dataRekomendasiTerakhir) siapkanDanRenderRekomendasi(dataRekomendasiTerakhir);
}

function bukaRekomendasi() {
    switchScreen('rekomendasi-screen');
    const body = document.getElementById('rekomendasi-body');
    body.innerHTML = 'Memuat data...';

    const cached = sessionStorage.getItem('hasil_terakhir');
    if (cached) {
        siapkanDanRenderRekomendasi(JSON.parse(cached));
        return;
    }

    const siswa = getSiswaData();
    const params = new URLSearchParams({ action: 'hasil', nama: siswa.nama, kelas: siswa.kelas, sekolah: siswa.sekolah });

    const pastikanSoalTerload = soalSudahDimuat ? Promise.resolve() : loadSoalFromServer();

    pastikanSoalTerload
        .then(() => fetch(urlScript + '?' + params.toString()))
        .then(r => {
            if (!r.ok) throw new Error('Status: ' + r.status);
            return r.json();
        })
        .then(data => {
            if (!data || data.result === 'not_found') {
                body.innerHTML = '<p>Belum ada data asesmen untuk siswa ini. Silakan lakukan Mulai Asesmen terlebih dahulu.</p>';
                return;
            }
            data = enrichJawabanRingkas(data);
            sessionStorage.setItem('hasil_terakhir', JSON.stringify(data));
            siapkanDanRenderRekomendasi(data);
        })
        .catch(err => {
            console.error(err);
            body.innerHTML = '<p>Gagal memuat data rekomendasi. Coba lagi nanti.</p>';
        });
}

let dataRekomendasiTerakhir = null;

function siapkanDanRenderRekomendasi(data) {
    dataRekomendasiTerakhir = data;
    const body = document.getElementById('rekomendasi-body');

    const cachedRekomendasi = sessionStorage.getItem('rekomendasi_ai_cache');
    if (cachedRekomendasi) {
        renderRekomendasi(data, JSON.parse(cachedRekomendasi));
        return;
    }

    body.innerHTML = 'Menganalisis jawaban dengan AI, mohon tunggu...';

    const dataSoalJawaban = data.jawaban.map(a => ({
        dimensi: a.dimensi,
        soal: a.soal,
        jawabanText: a.jawabanText,
        skor: a.skor,
    }));

    const params = new URLSearchParams();
    params.append('action', 'generateRekomendasi');
    params.append('dataSoalJawaban', JSON.stringify(dataSoalJawaban));

    fetch(urlScript, { method: 'POST', body: params })
        .then(r => r.json())
        .then(res => {
            if (res.result !== 'success') {
                body.innerHTML = `
                    <p>Gagal membuat rekomendasi AI: ${res.message || 'tidak diketahui'}</p>
                    <button type="button" style="width:auto; padding:8px 16px;" onclick="cobaLagiRekomendasi()">Coba Lagi</button>
                `;
                return;
            }
            sessionStorage.setItem('rekomendasi_ai_cache', JSON.stringify(res.rekomendasi));
            renderRekomendasi(data, res.rekomendasi);
        })
        .catch(err => {
            console.error(err);
            body.innerHTML = `
                <p>Gagal menghubungi AI. Cek koneksi internet.</p>
                <button type="button" style="width:auto; padding:8px 16px;" onclick="bukaRekomendasi()">Coba Lagi</button>
            `;
        });
}

function renderRekomendasi(data, rekomendasiArray) {
    const body = document.getElementById('rekomendasi-body');
    let html = '';
    rekomendasiCache = [];

    const adaSkorRendah = data.jawaban.some(a => a.skor <= 3);

    data.jawaban.forEach((a, i) => {
        const isBagus = a.skor > 3;
        const teks = rekomendasiArray[i] || 'Rekomendasi tidak tersedia untuk butir ini.';

        rekomendasiCache.push({ dimensi: a.dimensi, skor: a.skor, teks });

        const tampilkanTombolPerSoal = !isBagus;

        html += `
            <div style="margin-bottom:16px; padding-bottom:12px; border-bottom:1px solid #90CAF9;">
                <p style="margin:0 0 4px 0; color:#90CAF9; font-size:13px;">Soal ${i + 1} — ${a.dimensi} (Skor: ${a.skor})</p>
                <p style="margin:0 0 8px 0; font-size:14px; ${isBagus ? 'color:#22c55e;' : 'color:#f59e0b;'}">
                    ${isBagus ? '✅ Baik' : '⚠️ Perlu Ditingkatkan'} — ${teks}
                </p>
                ${tampilkanTombolPerSoal ? `<button type="button" style="width:auto; padding:6px 12px; font-size:12px;" onclick="bukaChatAI(${i})">💬 Tanya AI tentang ini</button>` : ''}
            </div>
        `;
    });

    if (!adaSkorRendah) {
        const indexTerakhir = data.jawaban.length - 1;
        html += `
            <div style="text-align:center; margin-top:8px;">
                <button type="button" style="width:auto; padding:8px 16px; font-size:13px;" onclick="bukaChatAI(${indexTerakhir})">💬 Tanya AI (pertanyaan bebas)</button>
            </div>
        `;
    }

    body.innerHTML = html;
}

// ================= ADMIN: LEADERBOARD =================
let leaderboardDataCache = [];

function loadLeaderboard() {
    const status = document.getElementById('leaderboardStatus');
    const table = document.getElementById('leaderboardTable');
    status.textContent = 'Memuat data...';
    table.style.display = 'none';

    const password = sessionStorage.getItem('admin_password') || '';

    Promise.all([
        fetch(urlScript + '?' + new URLSearchParams({ action: 'leaderboard', password }).toString()).then(r => r.json()),
        fetch(urlScript + '?' + new URLSearchParams({ action: 'getSekolahList' }).toString()).then(r => r.json()),
    ])
        .then(([leaderboardRes, sekolahRes]) => {
            if (leaderboardRes.result !== 'success') {
                status.textContent = leaderboardRes.message || 'Gagal memuat data (akses ditolak).';
                return;
            }
            leaderboardDataCache = leaderboardRes.data || [];

            const filterSekolah = document.getElementById('filterSekolah');
            filterSekolah.innerHTML = '<option value="">Semua Sekolah</option>';
            (sekolahRes.data || []).forEach(nama => {
                const opt = document.createElement('option');
                opt.value = nama;
                opt.textContent = nama;
                filterSekolah.appendChild(opt);
            });

            renderLeaderboardTable();
        })
        .catch(err => {
            console.error(err);
            status.textContent = 'Gagal memuat data leaderboard. Cek koneksi internet.';
        });
}

function renderLeaderboardTable() {
    const status = document.getElementById('leaderboardStatus');
    const table = document.getElementById('leaderboardTable');
    const tbody = document.getElementById('leaderboardTbody');

    const filterKelas = document.getElementById('filterKelas').value.trim();
    const filterSekolah = document.getElementById('filterSekolah').value.trim();
    const filterSort = document.getElementById('filterSort').value;

    let data = leaderboardDataCache.filter(row => {
        const cocokKelas = !filterKelas || (row.kelas || '').toString().trim() === filterKelas;
        const cocokSekolah = !filterSekolah || (row.sekolah || '').toString().trim() === filterSekolah;
        return cocokKelas && cocokSekolah;
    });

    if (filterSort === 'terendah') {
        data.sort((a, b) => a.totalSkor - b.totalSkor);
    } else {
        data.sort((a, b) => b.totalSkor - a.totalSkor);
    }

    if (data.length === 0) {
        status.textContent = 'Tidak ada data untuk filter ini.';
        table.style.display = 'none';
        return;
    }

    status.textContent = '';
    table.style.display = 'table';
    tbody.innerHTML = data.map(row => `
        <tr style="border-bottom:1px solid rgba(242,223,167,0.2);">
            <td style="padding:6px 4px;">${row.nama}</td>
            <td style="padding:6px 4px;">${row.kelas}</td>
            <td style="padding:6px 4px;">${row.jurusan}</td>
            <td style="padding:6px 4px;">${row.sekolah}</td>
            <td style="padding:6px 4px; text-align:right; font-weight:600; color:#90CAF9;">${row.totalSkor}</td>
        </tr>
    `).join('');
}

function tambahSekolah() {
    const input = document.getElementById('sekolahBaruInput');
    const nama = input.value.trim();
    if (!nama) {
        alert('Isi nama sekolah dulu.');
        return;
    }

    const password = sessionStorage.getItem('admin_password') || '';
    const btn = document.getElementById('btnTambahSekolah');
    btn.disabled = true;
    btn.textContent = '...';

    const params = new URLSearchParams();
    params.append('action', 'addSekolah');
    params.append('password', password);
    params.append('nama', nama);

    fetch(urlScript, { method: 'POST', body: params })
        .then(r => r.json())
        .then(data => {
            if (data.result === 'success') {
                input.value = '';
                loadLeaderboard();
            } else {
                alert(data.message || 'Gagal menambah sekolah.');
            }
        })
        .catch(err => {
            console.error(err);
            alert('Gagal menghubungi server.');
        })
        .finally(() => {
            btn.disabled = false;
            btn.textContent = '+ Tambah';
        });
}

// ================= ADMIN: EDITOR SOAL =================
let editorSoalCache = [];

function loadEditorSoal() {
    const container = document.getElementById('editorSoalList');
    container.innerHTML = '<p>Memuat data...</p>';

    fetch(urlScript + '?' + new URLSearchParams({ action: 'getSoal' }).toString())
        .then(r => r.json())
        .then(data => {
            if (data.result !== 'success') {
                container.innerHTML = `<p>Gagal memuat soal: ${data.message || 'tidak diketahui'}</p>`;
                return;
            }
            editorSoalCache = data.data;
            renderEditorSoalList();
        })
        .catch(err => {
            console.error(err);
            container.innerHTML = '<p>Gagal memuat data. Cek koneksi internet.</p>';
        });
}

function renderEditorSoalList() {
    const container = document.getElementById('editorSoalList');

    const grouped = {};
    editorSoalCache.forEach(soal => {
        if (!grouped[soal.marker]) grouped[soal.marker] = [];
        grouped[soal.marker].push(soal);
    });

    let html = '';
    Object.keys(grouped).map(Number).sort((a, b) => a - b).forEach(marker => {
        html += `<h3 style="color:#90CAF9; font-size:14px; margin-top:16px; margin-bottom:6px;">Marker ${marker + 1}</h3>`;
        grouped[marker].forEach((soal, idxDalamMarker) => {
            const pertanyaanSingkat = soal.pertanyaan.length > 80 ? soal.pertanyaan.slice(0, 80) + '...' : soal.pertanyaan;
            html += `
                <div style="display:flex; justify-content:space-between; align-items:center; gap:8px; padding:8px 0; border-bottom:1px solid rgba(242,223,167,0.2);">
                    <div style="flex:1; font-size:13px;">
                        <strong>Soal ${idxDalamMarker + 1}</strong> — ${soal.dimensi}<br>
                        <span style="color:#cbd5e1;">${pertanyaanSingkat}</span>
                    </div>
                    <button type="button" style="width:auto; padding:6px 12px; font-size:12px; margin:0;" onclick="bukaEditSoal(${soal.no})">Edit</button>
                </div>
            `;
        });
    });

    container.innerHTML = html || '<p>Belum ada soal.</p>';
}

function bukaEditSoal(no) {
    const soal = editorSoalCache.find(s => s.no === no);
    if (!soal) {
        alert('Soal tidak ditemukan.');
        return;
    }

    document.getElementById('editSoalNo').value = soal.no;
    document.getElementById('editSoalTitle').textContent = `Edit Soal — Marker ${soal.marker + 1}`;
    document.getElementById('editDimensi').value = soal.dimensi;
    document.getElementById('editPertanyaan').value = soal.pertanyaan;
    document.getElementById('editRekomendasi').value = soal.rekomendasi;

    const opsiContainer = document.getElementById('editOpsiContainer');
    opsiContainer.innerHTML = soal.opsi.map(opt => `
        <div style="display:flex; gap:8px; align-items:center; margin:6px 0;">
            <span style="width:20px; color:#90CAF9; font-weight:600;">${opt.key.toUpperCase()}</span>
            <input type="text" class="edit-opsi-text" data-key="${opt.key}" value="${opt.text.replace(/"/g, '&quot;')}" style="flex:3; margin:0;" />
            <input type="number" class="edit-opsi-skor" data-key="${opt.key}" value="${opt.skor}" min="1" max="5" style="flex:1; margin:0;" />
        </div>
    `).join('');

    document.getElementById('editSoalModal').style.display = 'flex';
}

function simpanEditSoal() {
    const no = document.getElementById('editSoalNo').value;
    const dimensi = document.getElementById('editDimensi').value.trim();
    const pertanyaan = document.getElementById('editPertanyaan').value.trim();
    const rekomendasi = document.getElementById('editRekomendasi').value.trim();

    if (!dimensi || !pertanyaan || !rekomendasi) {
        alert('Dimensi, pertanyaan, dan rekomendasi wajib diisi.');
        return;
    }

    const params = new URLSearchParams();
    params.append('action', 'updateSoal');
    params.append('password', sessionStorage.getItem('admin_password') || '');
    params.append('no', no);
    params.append('dimensi', dimensi);
    params.append('pertanyaan', pertanyaan);
    params.append('rekomendasi', rekomendasi);

    let adaKosong = false;
    document.querySelectorAll('.edit-opsi-text').forEach(input => {
        const key = input.dataset.key;
        const teks = input.value.trim();
        if (!teks) adaKosong = true;
        params.append('opsi' + key, teks);
    });
    document.querySelectorAll('.edit-opsi-skor').forEach(input => {
        const key = input.dataset.key;
        const skor = Number(input.value);
        if (!skor || skor < 1 || skor > 5) adaKosong = true;
        params.append('skor' + key, skor);
    });

    if (adaKosong) {
        alert('Semua opsi wajib diisi teksnya, dan skor wajib angka 1-5.');
        return;
    }

    const btn = document.getElementById('btnSimpanSoal');
    btn.disabled = true;
    btn.textContent = 'Menyimpan...';

    fetch(urlScript, { method: 'POST', body: params })
        .then(r => r.json())
        .then(data => {
            if (data.result === 'success') {
                document.getElementById('editSoalModal').style.display = 'none';
                loadEditorSoal();
            } else {
                alert(data.message || 'Gagal menyimpan perubahan.');
            }
        })
        .catch(err => {
            console.error(err);
            alert('Gagal menghubungi server.');
        })
        .finally(() => {
            btn.disabled = false;
            btn.textContent = 'Simpan Perubahan';
        });
}

// ================= CHATBOT AI (Tanya AI di Rekomendasi Hasil Asesmen) =================
function bukaChatAI(index) {
    chatAktifUntuk = index;
    const ctx = rekomendasiCache[index];
    document.getElementById('chat-dimensi-label').textContent = `Tanya AI — ${ctx.dimensi}`;

    const messagesEl = document.getElementById('chat-messages');
    messagesEl.innerHTML = `
        <div style="background:#0D47A1; border-radius:8px; padding:10px; margin-bottom:10px; font-size:13px;">
            <strong style="color:#90CAF9;">Rekomendasi:</strong> ${ctx.teks}
        </div>
        <div style="font-size:13px; color:#cbd5e1; margin-bottom:10px;">
            Ada yang ingin ditanyakan soal rekomendasi ini? Tanya AI di bawah ini.
        </div>
    `;

    document.getElementById('chat-modal').style.display = 'flex';
    document.getElementById('chatInput').value = '';
}

function tutupChatAI() {
    document.getElementById('chat-modal').style.display = 'none';
    chatAktifUntuk = null;
}

function tambahBubbleChat(teks, dariSiswa) {
    const messagesEl = document.getElementById('chat-messages');
    const bubble = document.createElement('div');
    bubble.style.margin = '6px 0';
    bubble.style.padding = '8px 12px';
    bubble.style.borderRadius = '10px';
    bubble.style.fontSize = '14px';
    bubble.style.maxWidth = '85%';
    bubble.style.whiteSpace = 'pre-wrap';
    if (dariSiswa) {
        bubble.style.background = '#90CAF9';
        bubble.style.color = '#0D47A1';
        bubble.style.marginLeft = 'auto';
    } else {
        bubble.style.background = '#0D47A1';
        bubble.style.color = '#ffffff';
        bubble.style.marginRight = 'auto';
    }
    bubble.textContent = teks;
    messagesEl.appendChild(bubble);
    messagesEl.scrollTop = messagesEl.scrollHeight;
}

function kirimPesanChat() {
    const input = document.getElementById('chatInput');
    const pertanyaan = input.value.trim();
    if (!pertanyaan || chatAktifUntuk === null) return;

    const ctx = rekomendasiCache[chatAktifUntuk];
    const siswa = getSiswaData();

    tambahBubbleChat(pertanyaan, true);
    input.value = '';

    const sendBtn = document.getElementById('chatSendBtn');
    sendBtn.disabled = true;
    sendBtn.textContent = '...';

    const params = new URLSearchParams();
    params.append('action', 'chat');
    params.append('pertanyaan', pertanyaan);
    params.append('nama', siswa.nama);
    params.append('dimensi', ctx.dimensi);
    params.append('rekomendasi', ctx.teks);
    params.append('skor', ctx.skor);

    fetch(urlScript, { method: 'POST', body: params })
        .then(r => {
            if (!r.ok) throw new Error('Status: ' + r.status);
            return r.json();
        })
        .then(data => {
            if (data.result === 'success') {
                tambahBubbleChat(data.jawaban, false);
            } else {
                tambahBubbleChat('Maaf, terjadi kendala: ' + (data.message || 'tidak diketahui'), false);
            }
        })
        .catch(err => {
            console.error(err);
            tambahBubbleChat('Maaf, gagal terhubung ke AI. Coba lagi nanti.', false);
        })
        .finally(() => {
            sendBtn.disabled = false;
            sendBtn.textContent = 'Kirim';
        });
}

// ================= HALAMAN MATERI (LMS: tab/sidebar per dimensi) =================
let materiIndexAktif = 0;

function renderMateriTabs() {
    const tabsEl = document.getElementById('lmsTabs');
    if (!tabsEl || typeof MATERI_DIMENSI === 'undefined') return;
    tabsEl.innerHTML = MATERI_DIMENSI.map((d, i) => `
        <button type="button" class="lms-tab ${i === materiIndexAktif ? 'lms-tab-active' : ''}" onclick="pilihMateriDimensi(${i})">
            ${d.no}. ${d.judul}
        </button>
    `).join('');
}

function renderMateriContent() {
    const contentEl = document.getElementById('lmsContent');
    if (!contentEl || typeof MATERI_DIMENSI === 'undefined') return;
    const d = MATERI_DIMENSI[materiIndexAktif];

    const deskripsiHtml = d.deskripsi.map(p => `<p>${p}</p>`).join('');
    const aplikasiHtml = d.aplikasi.map(p => `<p>${p}</p>`).join('');

    contentEl.innerHTML = `
        <h3 class="lms-dimensi-title">${d.no}. ${d.judul}</h3>
        <div class="lms-section">
            <span class="lms-section-badge lms-badge-deskripsi">Deskripsi</span>
            <div class="lms-section-box deskripsi">${deskripsiHtml}</div>
        </div>
        <div class="lms-section">
            <span class="lms-section-badge lms-badge-aplikasi">Aplikasi dalam Pembelajaran</span>
            <div class="lms-section-box aplikasi">${aplikasiHtml}</div>
        </div>
    `;
    contentEl.scrollTop = 0;

    document.getElementById('lmsProgressLabel').textContent = `Dimensi ${d.no} dari ${MATERI_DIMENSI.length}`;
    document.getElementById('lmsProgressFill').style.width = `${(d.no / MATERI_DIMENSI.length) * 100}%`;

    const prevBtn = document.getElementById('lmsPrevBtn');
    const nextBtn = document.getElementById('lmsNextBtn');
    prevBtn.disabled = materiIndexAktif === 0;
    nextBtn.textContent = materiIndexAktif === MATERI_DIMENSI.length - 1 ? 'Selesai ✓' : 'Selanjutnya ›';
}

function pilihMateriDimensi(index) {
    materiIndexAktif = index;
    renderMateriTabs();
    renderMateriContent();
}

function bukaMateri() {
    materiIndexAktif = 0;
    switchScreen('materi-screen');
    renderMateriTabs();
    renderMateriContent();
}

document.addEventListener('DOMContentLoaded', () => {
    const prevBtn = document.getElementById('lmsPrevBtn');
    const nextBtn = document.getElementById('lmsNextBtn');
    if (prevBtn) prevBtn.addEventListener('click', () => {
        if (materiIndexAktif > 0) pilihMateriDimensi(materiIndexAktif - 1);
    });
    if (nextBtn) nextBtn.addEventListener('click', () => {
        if (typeof MATERI_DIMENSI === 'undefined') return;
        if (materiIndexAktif < MATERI_DIMENSI.length - 1) {
            pilihMateriDimensi(materiIndexAktif + 1);
        } else {
            switchScreen('main-menu');
        }
    });
});
let splashAutoTimerId = null;
let splashSudahPindah = false;

function pindahDariSplashKeLogin() {
    if (splashSudahPindah) return;
    splashSudahPindah = true;

    if (splashAutoTimerId) clearTimeout(splashAutoTimerId);

    const splashContent = document.getElementById('splashContent');
    if (splashContent) splashContent.classList.add('splash-exit');

    setTimeout(() => {
        switchScreen('login-screen');
    }, 600); // harus sama dengan durasi animasi splash-exit di CSS
}

document.addEventListener('DOMContentLoaded', () => {
    const sudahAdaSesi = sessionStorage.getItem('admin_password') || sessionStorage.getItem('siswa_nama');
    if (sudahAdaSesi) {
        document.getElementById('splash-screen').classList.remove('active');
        document.getElementById('splash-screen').style.display = 'none';
        splashSudahPindah = true;
        return;
    }

    splashAutoTimerId = setTimeout(pindahDariSplashKeLogin, 5000);

    const btnLanjut = document.getElementById('btnLanjutSplash');
    if (btnLanjut) btnLanjut.addEventListener('click', pindahDariSplashKeLogin);
});

// ================= AUTO-RESTORE SESI (fitur "tetap login" setelah refresh) =================
document.addEventListener('DOMContentLoaded', () => {
    const adminPass = sessionStorage.getItem('admin_password');
    if (adminPass) {
        switchScreen('admin-menu-screen');
        return;
    }

    const siswa = getSiswaData();
    if (siswa.nama) {
        updateSapaanDashboard(siswa.nama);
        switchScreen('main-menu');
    }
});

// ================= INISIALISASI EVENT (tombol-tombol umum) =================
// Catatan: listener untuk 8 marker fisik (targetFound/targetLost) dan audio
// TIDAK didaftarkan di sini lagi — dipindah ke initArMarkerListeners() dan
// initArAudioDebugListeners(), yang baru dipanggil setelah <a-scene> disuntikkan
// ke DOM (lihat injectArSceneIfNeeded()), karena elemen-elemen itu belum ada
// sama sekali saat DOMContentLoaded jika belum pernah klik "Mulai Asesmen".
document.addEventListener('DOMContentLoaded', () => {
    try {
        const nextBtn = document.getElementById('quiz-next-btn');
        if (nextBtn) nextBtn.addEventListener('click', goToNextQuestion);

        const btnKirim = document.getElementById('btn-kirim');
        if (btnKirim) btnKirim.addEventListener('click', kirimData);

        const chatSendBtn = document.getElementById('chatSendBtn');
        if (chatSendBtn) chatSendBtn.addEventListener('click', kirimPesanChat);
        const chatInput = document.getElementById('chatInput');
        if (chatInput) chatInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') kirimPesanChat();
        });

        const filterKelas = document.getElementById('filterKelas');
        if (filterKelas) filterKelas.addEventListener('change', renderLeaderboardTable);
        const filterSekolah = document.getElementById('filterSekolah');
        if (filterSekolah) filterSekolah.addEventListener('change', renderLeaderboardTable);
        const filterSort = document.getElementById('filterSort');
        if (filterSort) filterSort.addEventListener('change', renderLeaderboardTable);
        const btnTambahSekolah = document.getElementById('btnTambahSekolah');
        if (btnTambahSekolah) btnTambahSekolah.addEventListener('click', tambahSekolah);
        const btnSimpanSoal = document.getElementById('btnSimpanSoal');
        if (btnSimpanSoal) btnSimpanSoal.addEventListener('click', simpanEditSoal);

    } catch (err) {
        console.error('Error saat inisialisasi:', err);
    }
});
