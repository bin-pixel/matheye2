/**
 * 메인 어플리케이션 구동 및 3D 그래픽 인프라 제어 스크립트
 */

// 1. 전역 시스템 변수 정의
let scene, camera, renderer, orbitControls, dragControls;
let controlPoints = [];      
let pointMeshes = [];        
let controlLine = null;      
let bezierLine = null;       

// 가이드라인 구체 렌더링 최적화를 위한 전역 공유 지오메트리 변수 (버그 해결 핵심)
let sharedSphereGeo = null;
let constructionObjects = [];

// 시뮬레이션 및 수동 추적 제어 변수
let droneMesh = null;
let tangentArrow = null;
let simTime = 0.25;          // 초기 기본 분석 단면 t 위치 
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

    // 정점 구체용 고유 지오메트리를 최초 1회만 캐싱하여 WebGL 리소스 중복 파괴 현상 원천 차단
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

// 5. 드 카스텔조 분할 가이드선 재생성 엔진 (안전성 대폭 강화)
function updateConstructionLines() {
    // 무대 위 개별 오브젝트 제거 및 고유 자원만 타겟 해제
    constructionObjects.forEach(obj => {
        scene.remove(obj);
        if (obj.isLine) obj.geometry.dispose(); // 라인의 고유 BufferGeometry 해제
        if (obj.material) obj.material.dispose(); // 각 매티리얼 자원 독립 해제
    });
    constructionObjects = [];

    if (!document.getElementById('toggle-construction').checked) return;

    let steps = BezierMath.getConstructionSteps(controlPoints, simTime);
    
    const layerColors = [
        0x10b981, // Level 1: 녹색 (Q라인)
        0x06b6d4, // Level 2: 청록색 (R라인)
        0xd946ef, // Level 3: 핑크색 (S라인)
        0xf97316, // Level 4: 오렌지색
        0xa855f7  // Level 5: 자수정색
    ];

    steps.forEach((stepPoints, levelIdx) => {
        let currentColor = layerColors[levelIdx % layerColors.length];

        // 1) 보간점들을 연결하는 결합 가이드선 드로잉
        if (stepPoints.length > 1) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(stepPoints);
            const lineMat = new THREE.LineBasicMaterial({ color: currentColor });
            const lineObj = new THREE.Line(lineGeo, lineMat);
            scene.add(lineObj);
            constructionObjects.push(lineObj);
        }

        // 2) 보간 마디 정점 미니 구체 배치 (전역 공유 지오메트리를 사용하여 크래시 방지)
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

    // 가이드 분할선 리렌더링 바인딩
    updateConstructionLines();
    refreshUIControls();
}

function refreshUIControls() {
    document.getElementById('curve-degree').innerText = controlPoints.length - 1;
    document.getElementById('points-count').innerText = controlPoints.length;

    const container = document.getElementById('dynamic-sliders-container');
    
    if (!container.contains(document.activeElement)) {
        container.innerHTML = '';
        controlPoints.forEach((p, idx) => {
            const isEnd = (idx === 0 || idx === controlPoints.length - 1);
            const titleColor = isEnd ? '#fda4af' : '#ffffff';
            const card = document.createElement('div');
            card.className = 'point-card';
            card.innerHTML = `
                <div class="point-header" style="color: ${titleColor}">POINT P${idx} ${isEnd ? '(시작/끝 정점)' : '(조절 제어점)'}</div>
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
}

function initUIEvents() {
    document.getElementById('preset-select').addEventListener('change', (e) => {
        loadPreset(e.target.value);
        resetSimulationState();
    });

    document.getElementById('toggle-construction').addEventListener('change', () => {
        updateConstructionLines();
    });

    // 수동 t값 입력 슬라이더 이벤트 리스너 바인딩 (수동 제어용)
    const tSlider = document.getElementById('input-t-value');
    const tDisplay = document.getElementById('t-value-display');
    tSlider.addEventListener('input', (e) => {
        if (isSimulating) return; // 자동 비행 중일 때는 수동 인터랙션 락(Lock)
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

        // 자동 구동 시 대시보드 내 UI 슬라이더 컴포넌트 위치 실시간 역동기화
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
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
