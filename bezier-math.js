/**
 * 3D 베지에 곡선 수학 연산 전용 스크립트 (General N-Degree Engine)
 */

const BezierMath = {
    /**
     * De Casteljau(드 카스텔조) 알고리즘을 사용한 n차수 베지에 공간 좌표 계산 함수
     * @param {THREE.Vector3[]} points - 제어점 벡터 배열
     * @param {number} t - 매개변수 시간 비율 (0.0 <= t <= 1.0)
     * @returns {THREE.Vector3} 계산된 곡선 상의 3D 좌표
     */
    getPosition: function(points, t) {
        if (!points || points.length === 0) return new THREE.Vector3();
        
        let coeffs = points.map(p => p.clone());
        
        while (coeffs.length > 1) {
            let nextCoeffs = [];
            for (let i = 0; i < coeffs.length - 1; i++) {
                let interpolated = new THREE.Vector3().lerpVectors(coeffs[i], coeffs[i+1], t);
                nextCoeffs.push(interpolated);
            }
            coeffs = nextCoeffs;
        }
        return coeffs[0];
    },

    /**
     * 드 카스텔조 알고리즘의 모든 중간 선형 보간 단계별 정점들을 추출하는 함수 (시각화 전용)
     * @param {THREE.Vector3[]} points - 제어점 벡터 배열
     * @param {number} t - 매개변수 시간 비율
     * @returns {THREE.Vector3[][]} 단계별 3D 좌표 다차원 배열
     */
    getConstructionSteps: function(points, t) {
        if (!points || points.length <= 1) return [];
        
        let steps = [];
        let coeffs = points.map(p => p.clone());
        
        // 반복 보간하며 생기는 모든 중간 단계 배열을 히스토리에 기록
        while (coeffs.length > 1) {
            let nextCoeffs = [];
            for (let i = 0; i < coeffs.length - 1; i++) {
                let interpolated = new THREE.Vector3().lerpVectors(coeffs[i], coeffs[i+1], t);
                nextCoeffs.push(interpolated);
            }
            steps.push(nextCoeffs);
            coeffs = nextCoeffs;
        }
        return steps;
    },

    /**
     * 미분 도함수 공식을 활용하여 특정 시점 t에서의 곡선 접선(Tangent) 단위 벡터 산출
     */
    getTangent: function(points, t) {
        let delta = 0.002;
        let t1 = t;
        let t2 = t + delta;
        
        if (t2 > 1.0) {
            t2 = 1.0;
            t1 = 1.0 - delta;
        }
        
        let pos1 = this.getPosition(points, t1);
        let pos2 = this.getPosition(points, t2);
        
        return new THREE.Vector3().subVectors(pos2, pos1).normalize();
    }
};
