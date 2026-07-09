/**
 * 메인 어플리케이션 구동 및 3D 그래픽 인프라 제어 스크립트 (성능 및 직관성 극대화 버전)
 */

let scene, camera, renderer, orbitControls, dragControls;
let controlPoints = [];      
let pointMeshes = [];        
let controlLine = null;      
let bezierLine = null;       

let sharedSphereGeo = null;
let constructionObjects = [];

let droneMesh = null;
let tangentArrow = null;
let simTime = 0.25;          
let isSimulating = false;

const PRESETS = {
    cubic: [
        new THREE.Vector3(-6, 2, -4),
        new THREE.Vector3(-3, 8, 4),
        new THREE.Vector3(3, 5, 5),
        new THREE.Vector3(6, 1, -2)
    ],
    helix: [
        new THREE.Vector3(-5, 0, -5),
        new THREE.Vector3(-3, 3, -2),
        new THREE.Vector3(-1, 6, 2),
        new THREE.Vector3(2, 4, 4),
        new THREE.Vector3(4, 1, 1),
        new THREE.Vector3(2, -3, -3),
        new THREE.Vector3(6, 5, -5)
    ],
    wave: [
        new THREE.Vector3(-8, 0, 0),
        new THREE.Vector3(-5, 6, 3),
        new THREE.Vector3(-2, -5, -3),
        new THREE.Vector3(1, 7, 4),
        new THREE.Vector3(4, -4, -2),
        new THREE.Vector3(8, 2, 0)
    ],
    loop: [
        new THREE.Vector3(-7, 1, 0),
        new THREE.Vector3(-2, 1, 5),
        new THREE.Vector3(0, 8, 0),
        new THREE.Vector3(2, 1, -5),
        new THREE.Vector3(7, 1, 0)
    ]
};

// 🎨 CSS 클래스와 정밀 결합된 20종류의 고대비 헥사 레이어 컬러맵
const LAYER_COLORS = [
    0x10b981, 0x06b6d4, 0xd946ef, 0xf97316, 0xa855f7,
    0xeab308, 0xef4444, 0x3b82f6, 0x84cc16, 0x14b8a6,
    0x6366f1, 0xec4899, 0xf43f5e, 0xf59e0b, 0x0ea5e9,
    0x22c55e, 0xff4500, 0xda70d6, 0x40e0d0, 0xffd700
];

window.onload = function() {
    init3DScene();
    loadPreset('cubic'); 
    initUIEvents();
    animateLoop();
};

function init3DScene() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f19);

    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 12, 18);

    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    let dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(10, 25, 15);
    scene.add(dirLight);

    orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;

    scene.add(new THREE.GridHelper(40, 40, 0x334155, 0x1e293b));
    scene.add(new THREE.AxesHelper(5));

    sharedSphereGeo = new THREE.SphereGeometry(0.14, 16, 16);

    const droneGeo = new THREE.ConeGeometry(0.25, 0.8, 16);
    droneGeo.rotateX(Math.PI / 2); 
    const droneMat = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.2 });
    droneMesh = new THREE.Mesh(droneGeo, droneMat);
    droneMesh.visible = false;
    scene.add(droneMesh);

    tangentArrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), 1.5, 0x38bdf8, 0.4, 0.2);
    tangentArrow.visible = false;
    scene.add(tangentArrow);
}

function loadPreset(key) {
    pointMeshes.forEach(m => scene.remove(m));
    pointMeshes = [];
    controlPoints = PRESETS[key].map(v => v.clone());
    
    buildPointMeshes();
    rebuildDragControls();
    buildSlidersUI(); // 프리셋 변동 시 최초 1회만 DOM 트리 빌드 (랙 방지)
    updateEngine();
}

function buildPointMeshes() {
    const geo = new THREE.SphereGeometry(0.35, 32, 32);
    controlPoints.forEach((p, idx) => {
        const isEnd = (idx === 0 || idx === controlPoints.length - 1);
        const mat = new THREE.MeshStandardMaterial({
            color: isEnd ? 0xf43f5e : 0xffffff, 
            metalness: 0.1, roughness: 0.3
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(p);
        mesh.userData = { index: idx };
        scene.add(mesh);
        pointMeshes.push(mesh);
    });
}

function rebuildDragControls() {
    if (dragControls) dragControls.dispose();
    dragControls = new THREE.DragControls(pointMeshes, camera, renderer.domElement);
    
    dragControls.addEventListener('dragstart', () => orbitControls.enabled = false);
    dragControls.addEventListener('drag', (e) => {
        const idx = e.object.userData.index;
        controlPoints[idx].copy(e.object.position);
        updateEngine();
    });
    dragControls.addEventListener('dragend', () => orbitControls.enabled = true);
}

/**
 * [성능 최적화 핵심] 매 프레임 UI를 파괴하지 않도록 슬라이더 구조를 단 1회만 빌드하는 독립 함수
 */
function buildSlidersUI() {
    const container = document.getElementById('dynamic-sliders-container');
    container.innerHTML = '';
    
    controlPoints.forEach((p, idx) => {
        const isEnd = (idx === 0 || idx === controlPoints.length - 1);
        const titleColor = isEnd ? '#fda4af' : '#ffffff';
        const card = document.createElement('div');
        card.className = 'point-card';
        card.innerHTML = `
            <div class="point-header" style="color: ${titleColor}">POINT P${idx} ${isEnd ? '(시작/끝 점)' : '(조절점)'}</div>
            ${['x','y','z'].map(axis => `
                <div class="axis-row">
                    <label>${axis.toUpperCase()}:</label>
                    <input type="range" min="-10" max="10" step="0.1" value="${p[axis].toFixed(1)}" data-idx="${idx}" data-axis="${axis}" class="coord-slider">
                    <span class="axis-val">${p[axis].toFixed(1)}</span>
                </div>
            `).join('')}
        `;
        container.appendChild(card);
    });

    document.querySelectorAll('.coord-slider').forEach(slider => {
        slider.addEventListener('input', (e) => {
            const idx = parseInt(e.target.dataset.idx);
            const axis = e.target.dataset.axis;
            const val = parseFloat(e.target.value);
            
            controlPoints[idx][axis] = val;
            pointMeshes[idx].position[axis] = val;
            
            e.target.nextElementSibling.innerText = val.toFixed(1);
            updateEngine();
        });
    });
}

function updateConstructionLines() {
    constructionObjects.forEach(obj => {
        scene.remove(obj);
        if (obj.isLine) obj.geometry.dispose(); 
        if (obj.material) obj.material.dispose(); 
    });
    constructionObjects = [];

    if (!document.getElementById('toggle-construction').checked) return;

    let steps = BezierMath.getConstructionSteps(controlPoints, simTime);

    steps.forEach((stepPoints, levelIdx) => {
        let currentColor = LAYER_COLORS[levelIdx % LAYER_COLORS.length];

        if (stepPoints.length > 1) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(stepPoints);
            const lineMat = new THREE.LineBasicMaterial({ color: currentColor });
            const lineObj = new THREE.Line(lineGeo, lineMat);
            scene.add(lineObj);
            constructionObjects.push(lineObj);
        }

        stepPoints.forEach((pos) => {
            const sphereMat = new THREE.MeshBasicMaterial({ color: currentColor });
            const sphereMesh = new THREE.Mesh(sharedSphereGeo, sphereMat);
            sphereMesh.position.copy(pos);
            scene.add(sphereMesh);
            constructionObjects.push(sphereMesh);
        });
    });
}

function updateEngine() {
    if (controlLine) scene.remove(controlLine);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(controlPoints);
    controlLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x55647a }));
    scene.add(controlLine);

    if (bezierLine) scene.remove(bezierLine);
    const curveSegments = 160;
    const computedVectors = [];
    for (let i = 0; i <= curveSegments; i++) {
        computedVectors.push(BezierMath.getPosition(controlPoints, i / curveSegments));
    }
    const bezierGeo = new THREE.BufferGeometry().setFromPoints(computedVectors);
    bezierLine = new THREE.Line(bezierGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 3 }));
    scene.add(bezierLine);

    updateConstructionLines();
    refreshUIControls();
}

function refreshUIControls() {
    document.getElementById('curve-degree').innerText = controlPoints.length - 1;
    document.getElementById('points-count').innerText = controlPoints.length;

    // [랙 최적화] 슬라이더 자체를 매번 지우지 않고 3D 마우스 조작 시 수치 컴포넌트만 정밀 타겟 갱신
    controlPoints.forEach((p, idx) => {
        ['x','y','z'].forEach(axis => {
            const slider = document.querySelector(`.coord-slider[data-idx="${idx}"][data-axis="${axis}"]`);
            if (slider && document.activeElement !== slider) {
                slider.value = p[axis].toFixed(1);
                slider.nextElementSibling.innerText = p[axis].toFixed(1);
            }
        });
    });

    let strX = "X(t) = ", strY = "Y(t) = ", strZ = "Z(t) = ";
    const n = controlPoints.length - 1;
    controlPoints.forEach((p, i) => {
        let weightStr = `·J_${i}^${n}(t)`;
        strX += `${i > 0 ? ' + ' : ''}${p.x.toFixed(1)}${weightStr}`;
        strY += `${i > 0 ? ' + ' : ''}${p.y.toFixed(1)}${weightStr}`;
        strZ += `${i > 0 ? ' + ' : ''}${p.z.toFixed(1)}${weightStr}`;
    });
    document.getElementById('matrix-x').innerText = strX;
    document.getElementById('matrix-y').innerText = strY;
    document.getElementById('matrix-z').innerText = strZ;

    // 🎯 [시각 직관성 전면 개편] 복잡한 개별 좌표 나열을 버리고 수렴 알고리즘의 직관적 진행 상황 요약 제공
    const traceContainer = document.getElementById('de-casteljau-trace');
    if (traceContainer) {
        let ratioLeft = (simTime * 100).toFixed(0);
        let ratioRight = (100 - ratioLeft);
        
        let traceHtml = `
            <div style="color: #cbd5e1; font-weight: bold; margin: 14px 0 6px 0; border-top: 1px dashed #2e3d52; padding-top: 10px; font-size: 11px;">
                🔍 대 카스텔조 기하학적 보간 흐름
            </div>
            <div style="font-size: 11px; color: #94a3b8; margin-bottom: 8px; white-space: normal; line-height: 1.4;">
                각 단계마다 선분들을 <span style="color: #34d399; font-weight: bold;">${ratioLeft} : ${ratioRight}</span> 내분점으로 쪼개며 점의 개수를 점진적으로 축소합니다.
            </div>
        `;
        
        let steps = BezierMath.getConstructionSteps(controlPoints, simTime);
        steps.forEach((stepPoints, levelIdx) => {
            let levelClass = `text-level-${levelIdx % 20}`;
            let initialCount = (levelIdx === 0) ? controlPoints.length : steps[levelIdx - 1].length;
            
            traceHtml += `
                <div style="margin-top: 5px; font-size: 11px; display: flex; align-items: center; justify-content: space-between;">
                    <span class="${levelClass}" style="font-weight: bold;">[계층 ${levelIdx + 1}]</span>
                    <span style="color: #cbd5e1;">기존 점 ${initialCount}개 ➔ <b style="color: #61dafb;">보간 조절점 ${stepPoints.length}개로 압축</b></span>
                </div>
            `;
        });

        if (steps.length > 0) {
            let finalPos = BezierMath.getPosition(controlPoints, simTime);
            traceHtml += `
                <div style="color: #34d399; margin-top: 12px; font-weight: bold; font-size: 12px; border-top: 1px solid #1e293b; padding-top: 8px; white-space: normal;">
                    🎯최종 수렴 곡선 점 B(t):<br/>
                    <span style="font-family: monospace; color: #fff;">(${finalPos.x.toFixed(2)}, ${finalPos.y.toFixed(2)}, ${finalPos.z.toFixed(2)})</span>
                </div>
            `;
        }
        traceContainer.innerHTML = traceHtml;
    }
}

function initUIEvents() {
    const infoPanel = document.getElementById('info-panel');
    const controlPanel = document.getElementById('control-panel');

    document.getElementById('btn-toggle-left').addEventListener('click', (e) => {
        infoPanel.classList.toggle('collapsed');
        e.target.innerText = infoPanel.classList.contains('collapsed') ? "▶" : "◀";
    });

    document.getElementById('btn-toggle-right').addEventListener('click', (e) => {
        controlPanel.classList.toggle('collapsed');
        e.target.innerText = controlPanel.classList.contains('collapsed') ? "◀" : "▶";
    });

    document.getElementById('preset-select').addEventListener('change', (e) => {
        loadPreset(e.target.value);
        resetSimulationState();
    });

    document.getElementById('toggle-construction').addEventListener('change', () => {
        updateConstructionLines();
    });

    const tSlider = document.getElementById('input-t-value');
    const tDisplay = document.getElementById('t-value-display');
    tSlider.addEventListener('input', (e) => {
        if (isSimulating) return; 
        simTime = parseFloat(e.target.value);
        tDisplay.innerText = simTime.toFixed(2);
        updateEngine();
    });

    document.getElementById('btn-add-point').addEventListener('click', () => {
        const lastPoint = controlPoints[controlPoints.length - 1];
        const newPoint = new THREE.Vector3(lastPoint.x + 2, lastPoint.y + 1, lastPoint.z);
        controlPoints.push(newPoint);
        
        pointMeshes.forEach(m => scene.remove(m));
        pointMeshes = [];
        buildPointMeshes();
        rebuildDragControls();
        buildSlidersUI(); // 구조 개수 변동 시 재생성
        updateEngine();
        resetSimulationState();
    });

    document.getElementById('btn-del-point').addEventListener('click', () => {
        if (controlPoints.length <= 2) {
            alert("베지에 곡선을 구성하기 위한 최소 제어점은 2개입니다.");
            return;
        }
        controlPoints.pop();
        
        pointMeshes.forEach(m => scene.remove(m));
        pointMeshes = [];
        buildPointMeshes();
        rebuildDragControls();
        buildSlidersUI(); // 구조 개수 변동 시 재생성
        updateEngine();
        resetSimulationState();
    });

    const simBtn = document.getElementById('btn-toggle-sim');
    simBtn.addEventListener('click', () => {
        isSimulating = !isSimulating;
        if(isSimulating) {
            simBtn.innerText = "⏸ 시뮬레이션 일시정지";
            simBtn.style.background = "linear-gradient(135deg, #eab308, #ca8a04)";
            droneMesh.visible = true;
            tangentArrow.visible = true;
        } else {
            simBtn.innerText = "▶ 투사체 시뮬레이션 시작";
            simBtn.style.background = "linear-gradient(135deg, #0284c7, #0369a1)";
        }
    });

    document.getElementById('btn-reset-sim').addEventListener('click', resetSimulationState);
}

function resetSimulationState() {
    isSimulating = false;
    simTime = 0.25; 
    document.getElementById('input-t-value').value = 0.25;
    document.getElementById('t-value-display').innerText = "0.25";
    
    droneMesh.visible = false;
    tangentArrow.visible = false;
    const simBtn = document.getElementById('btn-toggle-sim');
    simBtn.innerText = "▶ 투사체 시뮬레이션 시작";
    simBtn.style.background = "linear-gradient(135deg, #0284c7, #0369a1)";
    updateEngine();
}

function animateLoop() {
    requestAnimationFrame(animateLoop);
    orbitControls.update();

    if (isSimulating) {
        simTime += 0.003; 
        if (simTime > 1.0) simTime = 0.0; 

        document.getElementById('input-t-value').value = simTime;
        document.getElementById('t-value-display').innerText = simTime.toFixed(2);

        const currentPos = BezierMath.getPosition(controlPoints, simTime);
        const currentTangent = BezierMath.getTangent(controlPoints, simTime);

        droneMesh.position.copy(currentPos);
        const targetLook = new THREE.Vector3().addVectors(currentPos, currentTangent);
        droneMesh.lookAt(targetLook);

        tangentArrow.position.copy(currentPos);
        tangentArrow.setDirection(currentTangent);

        updateConstructionLines();
        refreshUIControls(); // 시뮬레이션 도중 수치 연동 최적화 반영
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
