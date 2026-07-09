
const BezierMath = {
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

    getConstructionSteps: function(points, t) {
        if (!points || points.length <= 1) return [];
        let steps = [];
        let coeffs = points.map(p => p.clone());
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
