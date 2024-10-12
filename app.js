// app.js

// XR globals.
let xrButton = document.getElementById('xr-button');
let xrSession = null;
let xrRefSpace = null;
let xrHitTestSource = null;

// WebGL and Three.js globals.
let gl = null;
let renderer = null;
let scene = null;
let camera = null;

// Game variables.
let vertices = [];
let field = null;
let isFieldCreated = false;
let reticle = null;
let line = null;

function initXR() {
  if (navigator.xr) {
    navigator.xr.isSessionSupported('immersive-ar').then((supported) => {
      if (supported) {
        xrButton.innerHTML = 'Enter AR';
        xrButton.disabled = false;
        xrButton.addEventListener('click', onButtonClicked);
      } else {
        xrButton.innerHTML = 'AR not supported';
      }
    });
  } else {
    xrButton.innerHTML = 'WebXR not available';
  }
}

function onButtonClicked() {
  if (!xrSession) {
    navigator.xr
      .requestSession('immersive-ar', {
        requiredFeatures: ['hit-test', 'dom-overlay'],
        domOverlay: { root: document.getElementById('overlay') },
      })
      .then(onSessionStarted, (e) => {
        console.error('Failed to start AR session:', e);
      });
  } else {
    xrSession.end();
  }
}

function onSessionStarted(session) {
  xrSession = session;
  xrButton.innerHTML = 'Exit AR';

  session.addEventListener('end', onSessionEnded);
  session.addEventListener('select', onSelect);

  let canvas = document.createElement('canvas');
  canvas.id = 'canvas';
  document.body.appendChild(canvas);
  gl = canvas.getContext('webgl', { xrCompatible: true });
  renderer = new THREE.WebGLRenderer({
    canvas: canvas,
    context: gl,
    alpha: true,
  });
  renderer.autoClear = false;

  session.updateRenderState({ baseLayer: new XRWebGLLayer(session, gl) });

  session.requestReferenceSpace('local').then((refSpace) => {
    xrRefSpace = refSpace;
    // Start rendering.
    session.requestAnimationFrame(onXRFrame);
  });

  // Set up hit testing.
  session.requestReferenceSpace('viewer').then((viewerSpace) => {
    xrSession
      .requestHitTestSource({ space: viewerSpace })
      .then((hitTestSource) => {
        xrHitTestSource = hitTestSource;
      });
  });

  setupThreeJS();
}

function onSessionEnded(event) {
  xrSession = null;
  xrButton.innerHTML = 'Enter AR';
  document.body.removeChild(renderer.domElement);
  gl = null;
  renderer = null;
  scene = null;
  camera = null;
  vertices = [];
  field = null;
  isFieldCreated = false;
  reticle = null;
  line = null;
  document.getElementById('status').innerHTML = '';
}

function onSelect(event) {
  if (reticle.visible && !isFieldCreated) {
    const position = new THREE.Vector3();
    position.setFromMatrixPosition(reticle.matrix);
    vertices.push(position.clone());

    // Visual feedback: place a small sphere at the vertex
    const sphereGeometry = new THREE.SphereGeometry(0.01, 16, 16);
    const sphereMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const sphere = new THREE.Mesh(sphereGeometry, sphereMaterial);
    sphere.position.copy(position);
    scene.add(sphere);

    updateLine();

    if (vertices.length === 4) {
      createPongField();
      isFieldCreated = true;
      document.getElementById('status').innerHTML = 'Pong field created!';
    } else {
      document.getElementById(
        'status'
      ).innerHTML = `Vertex ${vertices.length}/4 placed`;
    }
  }
}

function setupThreeJS() {
  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera();
  scene.add(camera);

  // Add a light
  const light = new THREE.DirectionalLight(0xffffff, 1);
  light.position.set(0, 10, 0);
  scene.add(light);

  // Reticle for hit testing
  const ringGeometry = new THREE.RingGeometry(0.05, 0.07, 32).rotateX(
    -Math.PI / 2
  );
  const ringMaterial = new THREE.MeshBasicMaterial({ color: 0xffffff });
  reticle = new THREE.Mesh(ringGeometry, ringMaterial);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  scene.add(reticle);
}

function createPongField() {
  // Remove the line connecting the vertices
  if (line) {
    scene.remove(line);
    line = null;
  }

  // Create geometry for the field as two triangles (a rectangle)
  const geometry = new THREE.BufferGeometry();

  const verticesArray = new Float32Array([
    vertices[0].x,
    vertices[0].y,
    vertices[0].z,
    vertices[1].x,
    vertices[1].y,
    vertices[1].z,
    vertices[2].x,
    vertices[2].y,
    vertices[2].z,

    vertices[2].x,
    vertices[2].y,
    vertices[2].z,
    vertices[3].x,
    vertices[3].y,
    vertices[3].z,
    vertices[0].x,
    vertices[0].y,
    vertices[0].z,
  ]);

  geometry.setAttribute(
    'position',
    new THREE.BufferAttribute(verticesArray, 3)
  );
  geometry.computeVertexNormals();

  const material = new THREE.MeshBasicMaterial({
    color: 0x00ff00,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.5,
  });

  field = new THREE.Mesh(geometry, material);
  scene.add(field);
}

function updateLine() {
  if (line) {
    scene.remove(line);
  }

  if (vertices.length > 1) {
    const points = vertices.slice();
    if (vertices.length === 4) {
      points.push(vertices[0]); // Close the loop
    }

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const lineMaterial = new THREE.LineBasicMaterial({ color: 0xffff00 });
    line = new THREE.Line(lineGeometry, lineMaterial);
    scene.add(line);
  }
}

function onXRFrame(t, frame) {
  let session = frame.session;
  session.requestAnimationFrame(onXRFrame);

  // Update viewport.
  let pose = frame.getViewerPose(xrRefSpace);
  if (pose) {
    const glLayer = session.renderState.baseLayer;
    renderer.setSize(
      glLayer.framebufferWidth,
      glLayer.framebufferHeight,
      false
    );

    gl.bindFramebuffer(gl.FRAMEBUFFER, glLayer.framebuffer);
    renderer.clear();

    // Update camera matrices.
    for (const view of pose.views) {
      const viewport = glLayer.getViewport(view);
      renderer.setViewport(
        viewport.x,
        viewport.y,
        viewport.width,
        viewport.height
      );

      camera.matrix.fromArray(view.transform.matrix);
      camera.projectionMatrix.fromArray(view.projectionMatrix);
      camera.updateMatrixWorld(true);

      // Perform hit testing.
      if (xrHitTestSource && !isFieldCreated) {
        const hitTestResults = frame.getHitTestResults(xrHitTestSource);
        if (hitTestResults.length > 0) {
          const hitPose = hitTestResults[0].getPose(xrRefSpace);
          reticle.visible = true;
          reticle.matrix.fromArray(hitPose.transform.matrix);
        } else {
          reticle.visible = false;
        }
      } else {
        reticle.visible = false;
      }

      // Render the scene.
      renderer.render(scene, camera);
    }
  }
}

initXR();
