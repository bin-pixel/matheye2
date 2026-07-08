/**
 * 메인 어플리케이션 구동 및 3D 그래픽 인프라 제어 스크립트
 */

// 1. 전역 시스템 변수 정의
let scene, camera, renderer, orbitControls, dragControls;
let controlPoints = [];      // 공간 좌표 Vector3 배열
let pointMeshes = [];        // 화면에 그려질 3D 구체 오브젝트 배열
let controlLine = null;      // 제어점들을 연결하는 가이드 라인
let bezierLine = null;       // 최종 연산된 베지에 곡선 라인

// 드 카스텔조 분할 가이드선 관리를 위한 가비지 콜렉팅 배열
let constructionObjects = [];

// 시뮬레이션용 드론 및 접선 벡터 화살표 오브젝트
let droneMesh = null;
let tangentArrow = null;
let simTime = 0.25;          // 시작 기본 매개변수 t값 (이미지 분석 기준과 동치)
let isSimulating = false;

// 2. 기하학 구조 프리셋 매트릭스 정의
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

// 3. 브라우저 로드 즉시 초기화 실행
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

    // 시뮬레이션 이동 드론 객체 (원뿔 모양 콘 지오메트리)
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

// 4. 프리셋 데이터 연동 처리
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
            color: isEnd ? 0xf43f5e : 0xffffff, // 최외각 조절선 폴리곤은 흰색/빨간색 매칭
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

// 5. 드 카스텔조 분할 가이드선 초기화 및 재생성 그리기 엔진
function updateConstructionLines() {
    // 기존에 생성되어 쌓여있던 곁가지 선분/점들 그래픽스 메모리 전면 석방
    constructionObjects.forEach(obj => {
        scene.remove(obj);
        if(obj.geometry) obj.geometry.dispose();
        if(obj.material) obj.material.dispose();
    });
    constructionObjects = [];

    // 만약 상단 체크박스가 체크 해제되어 있으면 연산 및 그리기를 즉시 캔슬 중단
    if (!document.getElementById('toggle-construction').checked) return;

    // 수학 모듈로부터 현재 계측 타임 t 분할 행렬 레이어 로드
    let steps = BezierMath.getConstructionSteps(controlPoints, simTime);
    
    // 단계별 시각적 개별 분할 처리를 위한 선명한 사이버 레이저 컬러 스펙트럼 배열 (이미지 매칭 패턴)
    const layerColors = [
        0x10b981, // Level 1: 녹색 (Q 라인)
        0x06b6d4, // Level 2: 청록/하늘색 (R 라인)
        0xd946ef, // Level 3: 보라/핑크색 (S 라인)
        0xf97316, // Level 4: 오렌지색
        0xa855f7  // Level 5: 자수정색
    ];

    const sphereGeo = new THREE.SphereGeometry(0.14, 16, 16);

    steps.forEach((stepPoints, levelIdx) => {
        let currentColor = layerColors[levelIdx % layerColors.length];

        // 1) 점들을 묶어 선분(Line) 구조체 빌드
        if (stepPoints.length > 1) {
            const lineGeo = new THREE.BufferGeometry().setFromPoints(stepPoints);
            const lineMat = new THREE.LineBasicMaterial({ 
                color: currentColor,
                linewidth: 2
            });
            const lineObj = new THREE.Line(lineGeo, lineMat);
            scene.add(lineObj);
            constructionObjects.push(lineObj);
        }

        // 2) 분할 마디점 위치마다 정밀 정점 미니 구체 매쉬 드로잉
        stepPoints.forEach((pos) => {
            const sphereMat = new THREE.MeshBasicMaterial({ color: currentColor });
            const sphereMesh = new THREE.Mesh(sphereGeo, sphereMat);
            sphereMesh.position.copy(pos);
            scene.add(sphereMesh);
            constructionObjects.push(sphereMesh);
        });
    });
}

// 6. 실시간 수학 연산 및 화면 갱신 코어 엔진 파이프라인
function updateEngine() {
    // 1) 제어점 간 최외각 가이드라인 드로잉 (회색 점선 형태)
    if (controlLine) scene.remove(controlLine);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(controlPoints);
    controlLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x55647a }));
    scene.add(controlLine);

    // 2) 베지에 메인 메인 기하 커브 생성
    if (bezierLine) scene.remove(bezierLine);
    const curveSegments = 160;
    const computedVectors = [];
    for (let i = 0; i <= curveSegments; i++) {
        computedVectors.push(BezierMath.getPosition(controlPoints, i / curveSegments));
    }
    const bezierGeo = new THREE.BufferGeometry().setFromPoints(computedVectors);
    bezierLine = new THREE.Line(bezierGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 35 }));
    scene.add(bezierLine);

    // 3) 드 카스텔조 분할선 동시 갱신
    updateConstructionLines();

    // 4) UI 스크롤 패널 데이터 리프레시
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

// 7. 버튼 및 체크박스 인터페이스 제어 이벤트 바인딩
function initUIEvents() {
    document.getElementById('preset-select').addEventListener('change', (e) => {
        loadPreset(e.target.value);
        resetSimulationState();
    });

    // 분할 가이드 가시화 토글 제어 스위치 리스너
    document.getElementById('toggle-construction').addEventListener('change', () => {
        updateConstructionLines();
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
    simTime = 0.25; // 리셋 시 기본 0.25 분석 단면 위치로 복귀 정렬
    droneMesh.visible = false;
    tangentArrow.visible = false;
    const simBtn = document.getElementById('btn-toggle-sim');
    simBtn.innerText = "▶ 투사체 시뮬레이션 시작";
    simBtn.style.background = "linear-gradient(135deg, #0284c7, #0369a1)";
    updateEngine();
}

// 8. 실시간 프레임 애니메이션 루프 가동
function animateLoop() {
    requestAnimationFrame(animateLoop);
    
    orbitControls.update();

    if (isSimulating) {
        simTime += 0.003; 
        if (simTime > 1.0) simTime = 0.0; 

        const currentPos = BezierMath.getPosition(controlPoints, simTime);
        const currentTangent = BezierMath.getTangent(controlPoints, simTime);

        droneMesh.position.copy(currentPos);
        
        const targetLook = new THREE.Vector3().addVectors(currentPos, currentTangent);
        droneMesh.lookAt(targetLook);

        tangentArrow.position.copy(currentPos);
        tangentArrow.setDirection(currentTangent);

        // 시뮬레이션이 돌며 시간이 흐를 때 가이드 분할선 행렬망도 함께 파도를 치며 동적 트래킹 연산 실행
        updateConstructionLines();
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
