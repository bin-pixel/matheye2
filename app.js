

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
let simSpeedStep = 0.003; 

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
    droneMesh.visible = true; 
    scene.add(droneMesh);

    tangentArrow = new THREE.ArrowHelper(new THREE.Vector3(1,0,0), new THREE.Vector3(), 1.5, 0x38bdf8, 0.4, 0.2);
    tangentArrow.visible = true; 
    scene.add(tangentArrow);
}

function loadPreset(key) {
    pointMeshes.forEach(m => scene.remove(m));
    pointMeshes = [];
    controlPoints = PRESETS[key].map(v => v.clone());
    
    buildPointMeshes();
    rebuildDragControls();
    buildSlidersUI(); 
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
    

    const currentPos = BezierMath.getPosition(controlPoints, simTime);
    const currentTangent = BezierMath.getTangent(controlPoints, simTime);

    droneMesh.position.copy(currentPos);
    const targetLook = new THREE.Vector3().addVectors(currentPos, currentTangent);
    droneMesh.lookAt(targetLook);

    tangentArrow.position.copy(currentPos);
    tangentArrow.setDirection(currentTangent);

    refreshUIControls();
}

function refreshUIControls() {
    document.getElementById('curve-degree').innerText = controlPoints.length - 1;
    document.getElementById('points-count').innerText = controlPoints.length;


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


    const finalPos = BezierMath.getPosition(controlPoints, simTime);
    const coordElem = document.getElementById('final-b-coordinates');
    if (coordElem) {
        coordElem.innerText = `(${finalPos.x.toFixed(2)}, ${finalPos.y.toFixed(2)}, ${finalPos.z.toFixed(2)})`;
    }
}

function initUIEvents() {
    const infoPanel = document.getElementById('info-panel');
    const topPanel = document.getElementById('top-control-panel');
    const bottomPanel = document.getElementById('bottom-control-panel');

    // 개별 패널 단위 토글 제어 인터랙션 믹스인
    document.getElementById('btn-toggle-left').addEventListener('click', (e) => {
        infoPanel.classList.toggle('collapsed');
        e.target.innerText = infoPanel.classList.contains('collapsed') ? "▶" : "◀";
    });

    document.getElementById('btn-toggle-top').addEventListener('click', (e) => {
        topPanel.classList.toggle('collapsed');
        e.target.innerText = topPanel.classList.contains('collapsed') ? "◀" : "▶";
    });

    document.getElementById('btn-toggle-bottom').addEventListener('click', (e) => {
        bottomPanel.classList.toggle('collapsed');
        e.target.innerText = bottomPanel.classList.contains('collapsed') ? "◀" : "▶";
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


    const speedSlider = document.getElementById('input-sim-speed');
    const speedDisplay = document.getElementById('speed-value-display');
    speedSlider.addEventListener('input', (e) => {
        simSpeedStep = parseFloat(e.target.value);

        let multiplier = (simSpeedStep / 0.003).toFixed(1);
        speedDisplay.innerText = multiplier + "x";
    });

    document.getElementById('btn-add-point').addEventListener('click', () => {
        const lastPoint = controlPoints[controlPoints.length - 1];
        const newPoint = new THREE.Vector3(lastPoint.x + 2, lastPoint.y + 1, lastPoint.z);
        controlPoints.push(newPoint);
        
        pointMeshes.forEach(m => scene.remove(m));
        pointMeshes = [];
        buildPointMeshes();
        rebuildDragControls();
        buildSlidersUI(); 
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
        buildSlidersUI(); 
        updateEngine();
        resetSimulationState();
    });

    const simBtn = document.getElementById('btn-toggle-sim');
    simBtn.addEventListener('click', () => {
        isSimulating = !isSimulating;
        if(isSimulating) {
            simBtn.innerText = "⏸ 시뮬레이션 일시정지";
            simBtn.style.background = "linear-gradient(135deg, #eab308, #ca8a04)";
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
    
    const simBtn = document.getElementById('btn-toggle-sim');
    simBtn.innerText = "▶ 투사체 시뮬레이션 시작";
    simBtn.style.background = "linear-gradient(135deg, #0284c7, #0369a1)";
    updateEngine();
}

function animateLoop() {
    requestAnimationFrame(animateLoop);
    orbitControls.update();

    if (isSimulating) {
        simTime += simSpeedStep;
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
        refreshUIControls(); 
    }

    renderer.render(scene, camera);
}

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});
