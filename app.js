/**
 * 메인 어플리케이션 구동 및 3D 그래픽 인프라 제어 스크립트
 */

// 1. 전역 시스템 변수 정의
let scene, camera, renderer, orbitControls, dragControls;
let controlPoints = [];      // 공간 좌표 Vector3 배열
let pointMeshes = [];        // 화면에 그려질 3D 구체 오브젝트 배열
let controlLine = null;      // 제어점들을 연결하는 가이드 라인
let bezierLine = null;       // 최종 연산된 베지에 곡선 라인

// 시뮬레이션용 드론 및 접선 벡터 화살표 오브젝트
let droneMesh = null;
let tangentArrow = null;
let simTime = 0.0;
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
    loadPreset('cubic'); // 최초 진입 시 기본 3차 곡선 렌더링
    initUIEvents();
    animateLoop();
};

function init3DScene() {
    // 3D 무대 공간 빌드
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0f19);

    // 카메라 원근 투영 설정
    camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 12, 18);

    // 웹글렌더러 구동 및 화면 추가
    renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    document.body.appendChild(renderer.domElement);

    // 환경 입체 조명 장착
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    let dirLight = new THREE.DirectionalLight(0xffffff, 0.5);
    dirLight.position.set(10, 25, 15);
    scene.add(dirLight);

    // 마우스 회전/확대축소 OrbitControls 탑재
    orbitControls = new THREE.OrbitControls(camera, renderer.domElement);
    orbitControls.enableDamping = true;
    orbitControls.dampingFactor = 0.05;

    // 바닥 격자망 및 원점 가이드 축 생성
    scene.add(new THREE.GridHelper(40, 40, 0x334155, 0x1e293b));
    scene.add(new THREE.AxesHelper(5));

    // 시뮬레이션 이동 드론 객체 (원뿔 모양 콘 지오메트리)
    const droneGeo = new THREE.ConeGeometry(0.25, 0.8, 16);
    droneGeo.rotateX(Math.PI / 2); // 정면을 바라보도록 앵글축 회전 보정
    const droneMat = new THREE.MeshStandardMaterial({ color: 0x34d399, roughness: 0.2 });
    droneMesh = new THREE.Mesh(droneGeo, droneMat);
    droneMesh.visible = false;
    scene.add(droneMesh);

    // 실시간 진행 방향을 가리키는 접선 벡터 화살표 헬퍼
    tangentArrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), 1.5, 0x38bdf8, 0.4, 0.2);
    tangentArrow.visible = false;
    scene.add(tangentArrow);
}

// 4. 프리셋 데이터 연동 처리
function loadPreset(key) {
    // 무대 위에 존재하는 기존 구체들을 싹 지워 메모리 확보
    pointMeshes.forEach(m => scene.remove(m));
    pointMeshes = [];
    
    // 프리셋 정보 카피 복사
    controlPoints = PRESETS[key].map(v => v.clone());
    
    buildPointMeshes();
    rebuildDragControls();
    updateEngine();
}

function buildPointMeshes() {
    const geo = new THREE.SphereGeometry(0.35, 32, 32);
    controlPoints.forEach((p, idx) => {
        // 첫 정점과 끝 정점은 빨간색, 중간 경유점들은 노란색으로 분류
        const isEnd = (idx === 0 || idx === controlPoints.length - 1);
        const mat = new THREE.MeshStandardMaterial({
            color: isEnd ? 0xf43f5e : 0xfbbf24,
            metalness: 0.1, roughness: 0.3
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.copy(p);
        mesh.userData = { index: idx };
        scene.add(mesh);
        pointMeshes.push(mesh);
    });
}

// 점들의 물리적 개수가 변동될 때 드래그 시스템 가동 범위 재정렬
function rebuildDragControls() {
    if (dragControls) dragControls.dispose();
    
    dragControls = new THREE.DragControls(pointMeshes, camera, renderer.domElement);
    
    // 드래그를 시작할 때 뷰포트 화면 회전 기능 끄기
    dragControls.addEventListener('dragstart', () => orbitControls.enabled = false);
    
    // 드래그 조작 연동 시 3D 위치값을 실시간으로 동기화 처리
    dragControls.addEventListener('drag', (e) => {
        const idx = e.object.userData.index;
        controlPoints[idx].copy(e.object.position);
        updateEngine();
    });
    
    // 드래그 마우스 버튼을 떼면 뷰포트 회전 복구
    dragControls.addEventListener('dragend', () => orbitControls.enabled = true);
}

// 5. 실시간 수학 연산 및 화면 갱신 코어 엔진 파이프라인
function updateEngine() {
    // 1) 제어점 간 가이드 선분 드로잉
    if (controlLine) scene.remove(controlLine);
    const lineGeo = new THREE.BufferGeometry().setFromPoints(controlPoints);
    controlLine = new THREE.Line(lineGeo, new THREE.LineBasicMaterial({ color: 0x475569 }));
    scene.add(controlLine);

    // 2) 베지에 메인 곡선 계산 및 고해상도 생성 (160단계 세그먼트 분할 계산)
    if (bezierLine) scene.remove(bezierLine);
    const curveSegments = 160;
    const computedVectors = [];
    for (let i = 0; i <= curveSegments; i++) {
        computedVectors.push(BezierMath.getPosition(controlPoints, i / curveSegments));
    }
    const bezierGeo = new THREE.BufferGeometry().setFromPoints(computedVectors);
    bezierLine = new THREE.Line(bezierGeo, new THREE.LineBasicMaterial({ color: 0x38bdf8, linewidth: 3 }));
    scene.add(bezierLine);

    // 3) UI 제어판 슬라이더 스케일링 리프레시 및 역방향 제어 연동
    refreshUIControls();
}

function refreshUIControls() {
    document.getElementById('curve-degree').innerText = controlPoints.length - 1;
    document.getElementById('points-count').innerText = controlPoints.length;

    const container = document.getElementById('dynamic-sliders-container');
    
    // 슬라이더 바를 마우스로 잡고 비비는 도중 레이아웃 포커스가 박살나 튕기는 에러 방지 처리 규칙
    if (!container.contains(document.activeElement)) {
        container.innerHTML = '';
        controlPoints.forEach((p, idx) => {
            const isEnd = (idx === 0 || idx === controlPoints.length - 1);
            const titleColor = isEnd ? '#fda4af' : '#fef08a';
            const card = document.createElement('div');
            card.className = 'point-card';
            card.innerHTML = `
                <div class="point-header" style="color: ${titleColor}">POINT P${idx} ${isEnd ? '(정점)' : '(제어 조절점)'}</div>
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

        // 수치 수동 미세조정 슬라이더 이벤트 즉시 바인딩 등록
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

    // 4) 최하단 실시간 파라메트릭 매개변수 다항식 대입 연출 문자열 처리
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

// 6. 버튼 인터페이스 제어 이벤트 바인딩
function initUIEvents() {
    // 셀렉트 박스 프리셋 변경
    document.getElementById('preset-select').addEventListener('change', (e) => {
        loadPreset(e.target.value);
        resetSimulationState();
    });

    // [+ 제어점 추가] 연산 메커니즘
    document.getElementById('btn-add-point').addEventListener('click', () => {
        const lastPoint = controlPoints[controlPoints.length - 1];
        // 마지막 점의 좌표에서 우측 대각선 방향으로 약간 전진 배열 연장
        const newPoint = new THREE.Vector3(lastPoint.x + 2, lastPoint.y + 1, lastPoint.z);
        
        controlPoints.push(newPoint);
        
        pointMeshes.forEach(m => scene.remove(m));
        pointMeshes = [];
        buildPointMeshes();
        rebuildDragControls();
        updateEngine();
        resetSimulationState();
    });

    // [- 마지막 점 삭제] 메커니즘 (곡선 최소 구성을 위한 방어선 2개 유지)
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

    // 투사체 애니메이션 재생 토글 인터페이스 스위칭
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
    simTime = 0.0;
    droneMesh.visible = false;
    tangentArrow.visible = false;
    const simBtn = document.getElementById('btn-toggle-sim');
    simBtn.innerText = "▶ 투사체 시뮬레이션 시작";
    simBtn.style.background = "linear-gradient(135deg, #0284c7, #0369a1)";
}

// 7. 실시간 프레임 애니메이션 루프 가동
function animateLoop() {
    requestAnimationFrame(animateLoop);
    
    orbitControls.update();

    // 시뮬레이션 활성화 중일 때 드론 비행 및 화살표 방향 수학적 변환 처리
    if (isSimulating) {
        simTime += 0.0035; // 드론 이동 속도 조절 상수 계수
        if (simTime > 1.0) simTime = 0.0; // t=1에 도달하면 무한 반복 루프 복귀

        // 분리된 수학 모듈 호출 연산
        const currentPos = BezierMath.getPosition(controlPoints, simTime);
        const currentTangent = BezierMath.getTangent(controlPoints, simTime);

        // 드론 위치값 동기화 적용
        droneMesh.position.copy(currentPos);
        
        // 드론의 진행 축 헤드가 접선 벡터 방향을 자연스럽게 꼬아보도록 회전 처리
        const targetLook = new THREE.Vector3().addVectors(currentPos, currentTangent);
        droneMesh.lookAt(targetLook);

        // 접선 벡터를 의미하는 푸른색 화살표 위치 및 방향 일치 변환
        tangentArrow.position.copy(currentPos);
        tangentArrow.setDirection(currentTangent);
    }

    renderer.render(scene, camera);
}

// 반응형 브라우저 가로 세로 리사이징 마운트 리스너
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
