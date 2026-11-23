import { NgTemplateOutlet } from '@angular/common';
import { Component, input, output, TemplateRef } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Edge, isEdge, isNode, Node } from '@visuallyjs/browser-ui';
import { InspectorComponent } from '@visuallyjs/browser-ui-angular';
import { CableEdgeData, DeviceNodeData, PortDirection, SIGNAL_TYPES } from './definitions';

@Component({
  selector: 'av-properties-inspector',
  imports: [FormsModule, NgTemplateOutlet],
  templateUrl: './properties-inspector.component.html',
  styles: [':host { display: flex; flex: 1; flex-direction: column; min-height: 0; }'],
})
export class PropertiesInspectorComponent extends InspectorComponent<Node | Edge> {
  readonly deviceForm = input.required<TemplateRef<{ $implicit: DeviceNodeData; template: boolean }>>();
  readonly activePortDirection = input.required<PortDirection>();
  readonly addDevicePort = output<DeviceNodeData>();
  readonly signalTypes = SIGNAL_TYPES;
  readonly isNode = isNode;
  readonly isEdge = isEdge;

  override reset(): void {
    super.reset();
    this.currentObj = null!;
  }

  deviceData(node: Node): DeviceNodeData {
    return node.data as DeviceNodeData;
  }

  cableData(edge: Edge): CableEdgeData {
    return edge.data as CableEdgeData;
  }
}
