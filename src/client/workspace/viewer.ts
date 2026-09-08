import {
  BufferGeometry, Color, DirectionalLight, GridHelper, HemisphereLight, Mesh,
  MeshStandardMaterial, PerspectiveCamera, Scene, Vector3, WebGLRenderer,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { fitCameraToBounds, type Bounds } from './preview.js';

export type ViewName = 'fit' | 'isometric' | 'top' | 'front';

export class PreviewViewer {
  private renderer: WebGLRenderer;
  private scene = new Scene();
  private camera = new PerspectiveCamera();
  private controls: OrbitControls;
  private grid = new GridHelper(200, 40, 0x9aa8ad, 0xd8dede);
  private mesh?: Mesh<BufferGeometry, MeshStandardMaterial>;
  private bounds?: Bounds;
  private observer: ResizeObserver;
  private lost = false;
  private disposed = false;
  private frame = 0;
  private labels: { element: HTMLElement; point: Vector3 }[];

  constructor(private host: HTMLElement, private onUnavailable: (message: string) => void, private onRestored: () => void) {
    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.domElement.tabIndex = 0;
    this.renderer.domElement.setAttribute('aria-label', 'STL model. Drag to orbit, scroll to zoom, arrow keys to pan.');
    this.host.prepend(this.renderer.domElement);
    this.camera.up.set(0, 0, 1);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = false;
    this.controls.enabled = false;
    this.controls.listenToKeyEvents(this.renderer.domElement);
    this.controls.addEventListener('change', this.invalidate);
    this.grid.rotation.x = Math.PI / 2;
    this.grid.position.z = -0.03;
    this.scene.add(this.grid);
    this.scene.add(new HemisphereLight(0xffffff, 0x64717e, 2.4));
    const key = new DirectionalLight(0xffffff, 3.1);
    key.position.set(-40, -60, 100);
    const fill = new DirectionalLight(0xffffff, 1.2);
    fill.position.set(70, 50, 40);
    this.scene.add(key, fill);
    this.labels = [
      { element: host.querySelector<HTMLElement>('[data-axis="x"]')!, point: new Vector3(50, 0, 0) },
      { element: host.querySelector<HTMLElement>('[data-axis="y"]')!, point: new Vector3(0, 50, 0) },
      { element: host.querySelector<HTMLElement>('[data-axis="origin"]')!, point: new Vector3(0, 0, 0) },
    ];
    this.renderer.domElement.addEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.addEventListener('webglcontextrestored', this.contextRestored);
    this.observer = new ResizeObserver(this.resize);
    this.observer.observe(host);
    this.setTheme();
    this.resize();
  }

  get available() { return !this.lost && !this.disposed; }

  private contextLost = (event: Event) => {
    event.preventDefault();
    this.lost = true;
    this.clear();
    this.onUnavailable('The graphics context was lost. The reference will reload when WebGL recovers. You can also reload this page.');
  };

  private contextRestored = () => {
    if (this.disposed) return;
    this.lost = false;
    this.resize();
    this.onRestored();
  };

  private invalidate = () => {
    if (this.frame || !this.available) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      try { this.render(); }
      catch {
        this.lost = true;
        this.clear();
        this.onUnavailable('WebGL could not render this preview. Reload the page to retry.');
      }
    });
  };

  private render() {
    if (!this.available) return;
    this.renderer.render(this.scene, this.camera);
    for (const { element, point } of this.labels) {
      const projected = point.clone().project(this.camera);
      const visible = this.mesh && Math.abs(projected.x) < 0.85 && Math.abs(projected.y) < 0.9 && Math.abs(projected.z) < 1;
      element.style.display = visible ? 'block' : 'none';
      element.style.left = `${(projected.x + 1) * this.host.clientWidth / 2}px`;
      element.style.top = `${(1 - projected.y) * this.host.clientHeight / 2}px`;
    }
  }

  private resize = () => {
    if (!this.available) return;
    const width = Math.max(1, this.host.clientWidth), height = Math.max(1, this.host.clientHeight);
    this.renderer.setSize(width, height, false);
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    if (this.bounds) this.setView('fit');
    this.invalidate();
  };

  setTheme() {
    const style = getComputedStyle(document.documentElement);
    this.scene.background = new Color(style.getPropertyValue('--bg').trim());
    const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const material of materials) { material.transparent = true; material.opacity = 0.38; }
    const colors = this.grid.geometry.getAttribute('color');
    const color = new Color(style.getPropertyValue('--muted').trim());
    for (let i = 0; i < colors.count; i++) colors.setXYZ(i, color.r, color.g, color.b);
    colors.needsUpdate = true;
    this.invalidate();
  }

  show(geometry: BufferGeometry, wireframe: boolean) {
    this.clear();
    if (!this.available) { geometry.dispose(); throw new Error('WebGL preview is unavailable.'); }
    const box = geometry.boundingBox!;
    this.bounds = { min: box.min.toArray(), max: box.max.toArray() };
    this.mesh = new Mesh(geometry, new MeshStandardMaterial({ color: 0xb6c0cc, metalness: 0.12, roughness: 0.58, wireframe }));
    this.scene.add(this.mesh);
    this.controls.enabled = true;
    this.setView('isometric');
    this.render();
    if (this.renderer.getContext().isContextLost()) throw new Error('WebGL graphics context is unavailable.');
    return box.max.clone().sub(box.min).toArray();
  }

  setView(name: ViewName) {
    if (!this.bounds || !this.available) return;
    const settings = fitCameraToBounds(this.bounds, this.camera.aspect);
    const target = new Vector3(...settings.target);
    let direction = this.camera.position.clone().sub(this.controls.target).normalize();
    if (name === 'isometric') direction = new Vector3(...settings.position).sub(target).normalize();
    // The tiny Y offset keeps a Z-up camera well-defined at the top-view pole.
    if (name === 'top') direction.set(0, -0.0001, 1).normalize();
    if (name === 'front') direction.set(0, -1, 0);
    const distance = new Vector3(...settings.position).distanceTo(target);
    this.camera.fov = settings.fov;
    this.camera.near = settings.near;
    this.camera.far = settings.far;
    this.camera.up.set(...settings.up);
    this.camera.position.copy(target).addScaledVector(direction, distance);
    this.controls.target.copy(target);
    this.controls.minDistance = settings.near * 20;
    this.controls.maxDistance = settings.far / 2;
    this.camera.updateProjectionMatrix();
    this.camera.lookAt(target);
    this.controls.update();
    this.invalidate();
  }

  setWireframe(enabled: boolean) {
    if (this.mesh) { this.mesh.material.wireframe = enabled; this.invalidate(); }
  }

  clear() {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
    if (this.mesh) {
      this.scene.remove(this.mesh);
      this.mesh.geometry.dispose();
      this.mesh.material.dispose();
      this.mesh = undefined;
    }
    this.bounds = undefined;
    this.controls.enabled = false;
    for (const { element } of this.labels) element.style.display = 'none';
    if (this.available) this.renderer.clear();
  }

  dispose() {
    this.clear();
    this.disposed = true;
    this.observer.disconnect();
    this.controls.removeEventListener('change', this.invalidate);
    this.controls.dispose();
    this.renderer.domElement.removeEventListener('webglcontextlost', this.contextLost);
    this.renderer.domElement.removeEventListener('webglcontextrestored', this.contextRestored);
    this.grid.geometry.dispose();
    const materials = Array.isArray(this.grid.material) ? this.grid.material : [this.grid.material];
    for (const material of materials) material.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
