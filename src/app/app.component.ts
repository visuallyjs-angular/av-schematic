import { NgTemplateOutlet } from "@angular/common";
import { AfterViewInit, ChangeDetectorRef, Component, NgZone, ViewChild, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  type CanvasDropFilter,
  type DataGeneratorFunction,
  CONNECTOR_TYPE_ORTHOGONAL,
  Edge,
  Port,
  EVENT_DESELECT,
  EVENT_SELECT,
  EVENT_SELECTION_CLEARED,
  EVENT_EDGE_REMOVED,
  EVENT_NODE_REMOVED,
  EVENT_CANVAS_CLICK,
  EVENT_EDGE_CLICK,
  EVENT_VERTEX_TAP,
  ModelOptions,
  Node,
  SurfaceOptions,
  uuid,
} from '@visuallyjs/browser-ui';
import { SurfaceComponent, VisuallyJsModule } from '@visuallyjs/browser-ui-angular';
import { DeviceComponent } from './device.component';
import edgeMappings from './edge-mappings';
import { LibraryDevice, DEVICE_LIBRARY, createBlankTemplate } from './devices';
import { PropertiesInspectorComponent } from './properties-inspector.component';
import { Exporter, type DxfPrimitive } from '@visuallyjs/browser-ui-export';
import {
  CONNECTOR_TYPES,
  DEVICE_TYPES,
  DeviceNodeData,
  DevicePort,
  generateDeviceId,
  PortDirection,
} from "./definitions";

@Component({
  selector: 'app-root',
  imports: [FormsModule, NgTemplateOutlet, PropertiesInspectorComponent, VisuallyJsModule],
  templateUrl: './app.component.html',
})
export class AppComponent implements AfterViewInit {
  @ViewChild(SurfaceComponent) canvas!: SurfaceComponent;
  private readonly zone = inject(NgZone);
  private readonly changeDetector = inject(ChangeDetectorRef);
  readonly library = signal(structuredClone(DEVICE_LIBRARY));
  readonly libraryOpen = signal(true);
  readonly propertiesOpen = signal(true);
  readonly grid = { width: 20, height: 20 };
  readonly dark = signal(localStorage.getItem('av-schematic-theme') === 'dark');
  readonly query = signal('');
  readonly portTabs = ['input', 'output'] as const;
  readonly activePortTab = signal<PortDirection>('input');
  readonly deviceTypes = DEVICE_TYPES;
  private readonly collapsedCategories = signal<ReadonlySet<string>>(new Set());
  readonly libraryGroups = computed(() => {
    const groups = new Map<string, LibraryDevice[]>();
    for (const item of this.library()) {
      const key = item.template.category?.trim() || '';
      const items = groups.get(key) ?? [];
      items.push(item);
      groups.set(key, items);
    }
    const orderedKeys = new Set([...this.deviceTypes.map(type => type.name), ...groups.keys()].filter(Boolean));
    return [...orderedKeys, ''].flatMap(key => {
      const items = groups.get(key);
      const label = key ? key.replace(/-/g, ' ').replace(/\b\w/g, char => char.toUpperCase()) : 'Other';
      return items ? [{ key, label, items }] : [];
    });
  });
  readonly connectors = CONNECTOR_TYPES;
  draft: DeviceNodeData | null = null;
  draftId: string | null = null;

  readonly viewOptions = {
    nodes: { device: { component: DeviceComponent } },
    edges: {
      default: {
        overlays: [
          { type: 'Label', options: { id: 'cable-start-label', location: 0.2, label: '{{cableId}}' } },
          { type: 'Label', options: { id: 'cable-end-label', location: 0.8, label: '{{cableId}}' } },
        ]
      },
    },
  };

  readonly renderOptions: SurfaceOptions = {
    activeFiltering: true,
    zoomToFit: true,
    allowLoopbackEdges: true,
    edges: {
      connector: { type: CONNECTOR_TYPE_ORTHOGONAL, options: { cornerRadius: 4, stub: 20 } },
      editable: true,
      detachable: true,
      allowUnattached: true,
      propertyMappings: edgeMappings(),
    },
  };

  private portSpec(port: Port): DevicePort | undefined {
    const parentData = port.getParent()?.data as DeviceNodeData | undefined;
    return parentData?.ports?.find(p => p.id === port.id) ?? (port.data as DevicePort | undefined);
  }

  private canConnect(source: unknown, target: unknown): boolean {
    if (source === target) return false;
    if (source instanceof Port && target instanceof Port) {
      if (source.getParent() === target.getParent()) return false;
      const src = this.portSpec(source);
      const tgt = this.portSpec(target);
      if (!src || !tgt) return false;
      if (src.direction !== 'output' || tgt.direction !== 'input') return false;
      if (src.connectorType !== tgt.connectorType) return false;
    }
    return true;
  }

  readonly modelOptions: ModelOptions = {
    beforeConnect: (source, target) => this.canConnect(source, target),
    beforeMoveConnection: (source, target) => this.canConnect(source, target),
    nodeFactory: (model, _type, data, complete) => {
      const device = data as DeviceNodeData;


      complete({ ...data, id: uuid(), deviceId: generateDeviceId(device.category, model) });
      return true;
    },
    edgeFactory: (_model, _type, data, complete) => {
      complete({ ...data, type: 'cable', cableId: 'C-' + uuid().slice(0, 8) });
      return true;
    },
  };

  ngAfterViewInit(): void {
    const { model, surface } = this.canvas;
    surface.setGrid(this.grid);
    surface.bind(EVENT_EDGE_CLICK, ({ obj }: { obj: Edge }) => model.setSelection(obj));
    surface.bind(EVENT_VERTEX_TAP, ({ obj }: { obj: Node | Port }) =>
      model.setSelection(obj instanceof Port ? obj.getParent() : obj));
    surface.bind(EVENT_CANVAS_CLICK, () => model.clearSelection());
    const refreshSelection = (openProperties: boolean) => this.zone.run(() => {
      const selection = model.getSelection();
      const items = [...selection.getNodes(), ...selection.getEdges()];
      if (openProperties && items.length) this.propertiesOpen.set(true);
      const connected = new Set(items.flatMap(item => item instanceof Node
        ? item.getAllEdges().map(edge => edge.id) : [item.id]));
      for (const element of surface.getContainer().querySelectorAll('[data-vjs-edge]')) {
        element.classList.toggle('av-connected-cable', connected.has(element.getAttribute('data-vjs-edge') ?? ''));
      }
      this.changeDetector.markForCheck();
    });
    const updateSelection = () => refreshSelection(true);
    const updateAfterRemoval = () => refreshSelection(false);
    model.bind(EVENT_NODE_REMOVED, updateAfterRemoval);
    model.bind(EVENT_EDGE_REMOVED, updateAfterRemoval);
    model.bind(EVENT_SELECT, updateSelection);
    model.bind(EVENT_DESELECT, updateSelection);
    model.bind(EVENT_SELECTION_CLEARED, updateSelection);
  }

  isCategoryOpen(key: string): boolean {
    return !this.collapsedCategories().has(key);
  }

  setCategoryOpen(key: string, open: boolean): void {
    this.collapsedCategories.update(current => {
      const next = new Set(current);
      if (open) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  readonly searchQuery = computed(() => this.query().trim());

  readonly filteredLibrary = computed(() => {
    const query = this.searchQuery();
    if (!query) return [];
    const matcher = new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'giu');

    return this.library().flatMap(item => {
      const { manufacturer, model } = item.template;
      const matches = [manufacturer, model].map(text => ({ text, ranges: [...text.matchAll(matcher)] }));
      if (matches.every(({ ranges }) => ranges.length === 0)) return [];

      const segments: { text: string; match: boolean }[] = [];
      for (const [index, { text, ranges }] of matches.entries()) {
        if (index > 0) segments.push({ text: ' ', match: false });
        let end = 0;
        for (const match of ranges) {
          if (match.index > end) segments.push({ text: text.slice(end, match.index), match: false });
          segments.push({ text: match[0], match: true });
          end = match.index + match[0].length;
        }
        if (end < text.length) segments.push({ text: text.slice(end), match: false });
      }
      return [{ item, segments }];
    });
  });

  private get selectedNode(): Node | null {
    const selection = this.canvas?.model?.getSelection();
    if (!selection || selection.getNodeCount() !== 1 || selection.getEdgeCount() !== 0) return null;
    return selection.getNodeAt(0);
  }

  readonly paletteData: DataGeneratorFunction = element => {
    const libraryId = element.getAttribute('data-library-id');
    const template = this.library().find(item => item.libraryId === libraryId)?.template;
    return template ? structuredClone(template) : {};
  };

  readonly canDropDevice: CanvasDropFilter = data => data['type'] === 'device';

  editTemplate(id?: string): void {
    this.draftId = id ?? null;
    const template = this.library().find(item => item.libraryId === id)?.template;
    this.draft = template
      ? { ...createBlankTemplate(), ...structuredClone(template) }
      : createBlankTemplate();
  }

  saveTemplate(): void {
    if (!this.draft) return;
    const libraryId = this.draftId ?? uuid();
    const entry = { libraryId, template: this.draft };
    this.library.update(items => this.draftId
      ? items.map(item => item.libraryId === libraryId ? entry : item)
      : [...items, entry]);
    this.draft = null;
  }

  deleteTemplate(): void {
    this.library.update(items => items.filter(item => item.libraryId !== this.draftId));
    this.draft = null;
  }

  editDevice(device: DeviceNodeData, changes: Partial<DeviceNodeData>): void {
    if (device === this.draft) {
      Object.assign(device, changes);
      return;
    }
    const node = this.selectedNode;
    if (!node) return;
    this.canvas.model.updateNode(node, changes);
    requestAnimationFrame(() => {
      const element = this.canvas.surface.getRenderedElement(node.id);
      if (element) this.canvas.surface.$revalidateElement(element);
    });
  }

  editPort(device: DeviceNodeData, port: DevicePort, changes: Partial<DevicePort>): void {
    this.editDevice(device, { ports: device.ports.map(item => item.id === port.id ? { ...item, ...changes } : item) });
  }

  addPort(device: DeviceNodeData, direction: PortDirection = 'input'): void {
    this.editDevice(device, { ports: [...device.ports, { id: uuid(), label: 'New port', direction }] });
  }

  removePort(device: DeviceNodeData, port: DevicePort): void {
    const node = this.selectedNode;
    if (device !== this.draft && node) this.canvas.model.removePort(node, port.id);
    this.editDevice(device, { ports: device.ports.filter(item => item.id !== port.id) });
  }

  portsFor(device: DeviceNodeData, direction: PortDirection): DevicePort[] {
    return device.ports.filter(port => port.direction === direction);
  }

  onPortTabKey(event: KeyboardEvent): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'input' : event.key === 'End' ? 'output'
      : this.activePortTab() === 'input' ? 'output' : 'input';
    this.activePortTab.set(next);
    (event.currentTarget as HTMLElement).querySelector<HTMLElement>('#port-tab-' + next)?.focus();
  }

  movePort(device: DeviceNodeData, port: DevicePort, offset: number, direction?: PortDirection): void {
    const ports = [...device.ports];
    const visible = direction ? this.portsFor(device, direction) : ports;
    const index = ports.indexOf(port);
    const neighbor = visible[visible.indexOf(port) + offset];
    const other = ports.indexOf(neighbor);
    if (other < 0 || other >= ports.length) return;
    [ports[index], ports[other]] = [ports[other], ports[index]];
    this.editDevice(device, { ports });
  }

  toggleTheme(): void {
    this.dark.update(value => !value);
    localStorage.setItem('av-schematic-theme', this.dark() ? 'dark' : 'light');
  }

  downloadDxf(): void {
    const surface = this.canvas.surface;
    const measure = document.createElement('canvas').getContext('2d');
    const zoom = surface.getZoom();
    const { dxf, warnings } = new Exporter(surface).exportDxf({
      units: 'mm',
      scale: 0.3,
      renderVertex: vertex => {
        if (vertex.kind !== 'node') return undefined;
        const data = vertex.data as unknown as DeviceNodeData;
        const { width, height } = vertex.bounds;
        const deviceRect = vertex.element.getBoundingClientRect();
        const artwork: DxfPrimitive[] = [];
        const outline = (x: number, y: number, w: number, h: number) => {
          artwork.push({
            type: 'polyline', closed: true, points: [
              { x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h },
            ]
          });
        };
        outline(0, 0, width, height);
        artwork.push(
          { type: 'text', position: { x: 8, y: 19 }, height: 14, text: data.deviceId },
          { type: 'text', position: { x: 8, y: 35 }, height: 12, text: [data.manufacturer, data.model].join(' ') },
        );
        for (const port of vertex.ports) {
          const details = data.ports.find(item => item.id === port.id);
          if (!details) continue;
          outline(port.x, port.y, port.width, port.height);
          const output = details.direction === 'output';
          const jack = vertex.element.querySelector(`[data-vjs-port="${CSS.escape(port.id)}"]`);
          const label = jack?.nextElementSibling;
          const type = label?.querySelector('small');
          const labelRect = label?.getBoundingClientRect();
          const x = labelRect
            ? ((output ? labelRect.right : labelRect.left) - deviceRect.left) / zoom
            : output ? port.x - 6 : port.x + port.width + 6;
          const align = output ? 'end' : 'start';

          // CAD TEXT height measures capitals, while CSS font-size measures the em.
          const textGeometry = (element: Element | null | undefined, fallbackSize: number, fallbackY: number) => {
            const node = element?.firstChild;
            if (!element || node?.nodeType !== globalThis.Node.TEXT_NODE || !measure) {
              return { height: fallbackSize * 0.72, baseline: fallbackY };
            }
            const style = getComputedStyle(element);
            measure.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
            const metrics = measure.measureText('H');
            const range = document.createRange();
            range.selectNodeContents(node);
            const rect = range.getBoundingClientRect();
            const baseline = (rect.top + rect.height / 2 - deviceRect.top) / zoom
              + (metrics.fontBoundingBoxAscent - metrics.fontBoundingBoxDescent) / 2;
            return { height: metrics.actualBoundingBoxAscent || fallbackSize * 0.72, baseline };
          };
          const name = textGeometry(label, 11, port.y + 5);
          const connector = textGeometry(type, 10, port.y + 17);
          const connectorBaseline = Math.max(connector.baseline, name.baseline + connector.height + 2);
          artwork.push(
            { type: 'text', position: { x, y: name.baseline }, height: name.height, text: details.label, align },
            { type: 'text', position: { x, y: connectorBaseline }, height: connector.height, text: details.connectorType ?? '', align },
          );
        }
        return artwork;
      },
    });
    if (warnings.length) console.warn('DXF export warnings', warnings);
    const url = URL.createObjectURL(new Blob([dxf], { type: 'application/dxf' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'av-schematic.dxf';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
