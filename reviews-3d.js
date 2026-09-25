import * as THREE from 'three';
import { FBXLoader } from 'three/addons/loaders/FBXLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export async function mountFbx(container, blob) {
  const object = new FBXLoader().parse(await blob.arrayBuffer(), '');
  const bounds = new THREE.Box3().setFromObject(object);
  if (bounds.isEmpty()) throw new Error('El FBX no contiene geometría visible.');
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(size.x, size.y, size.z, 1);
  object.position.sub(center);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x202020);
  scene.add(new THREE.HemisphereLight(0xffffff, 0x555555, 2.5));
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  sun.position.set(radius, radius * 2, radius);
  scene.add(sun, object);
  const camera = new THREE.PerspectiveCamera(45, 1, Math.max(radius / 1000, .01), radius * 1000);
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  container.replaceChildren(renderer.domElement);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.screenSpacePanning = true;
  const fit = () => { camera.position.set(radius * 1.6, radius * 1.1, radius * 1.6); controls.target.set(0, 0, 0); controls.update(); };
  fit();
  const resize = () => { const width = Math.max(1, container.clientWidth), height = Math.max(1, container.clientHeight); camera.aspect = width / height; camera.updateProjectionMatrix(); renderer.setSize(width, height, false); };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  const mixer = object.animations?.length ? new THREE.AnimationMixer(object) : null;
  if (mixer) mixer.clipAction(object.animations[0]).play();
  const clock = new THREE.Clock();
  let frame;
  const animate = () => { frame = requestAnimationFrame(animate); mixer?.update(clock.getDelta()); controls.update(); renderer.render(scene, camera); };
  animate();
  return {
    canvas: renderer.domElement,
    fit,
    dispose() {
      cancelAnimationFrame(frame);
      observer.disconnect();
      controls.dispose();
      object.traverse(node => { node.geometry?.dispose(); if (Array.isArray(node.material)) node.material.forEach(material => material.dispose()); else node.material?.dispose(); });
      renderer.dispose();
      container.replaceChildren();
    },
  };
}
