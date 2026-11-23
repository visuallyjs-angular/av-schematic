import { Component } from '@angular/core';
import { BaseNodeComponent } from '@visuallyjs/browser-ui-angular';
import { DeviceNodeData, DevicePort } from './definitions';

@Component({
  selector: 'app-device',
  template: `
    <article class="device">
      <header><strong>{{device.deviceId}}</strong><small>{{device.manufacturer}} {{device.model}}</small></header>
      <div class="ports">
        @for (direction of directions; track direction) {
          <div>
            @for (port of ports(direction); track port.id) {
              <div class="port-row" [class.output]="direction === 'output'">
                <button class="jack" type="button" data-vjs-source="true" data-vjs-target="true"
                  [attr.data-vjs-port]="port.id" [attr.data-vjs-anchor]="direction === 'input' ? 'Left' : 'Right'"
                  [attr.data-vjs-scope]="port.connectorType || null"
                  [attr.aria-label]="port.label"></button>
                <span>{{port.label}}<small>{{port.connectorType}}</small></span>
              </div>
            }
          </div>
        }
      </div>
    </article>
  `,
})
export class DeviceComponent extends BaseNodeComponent {
  readonly directions = ['input', 'output'] as const;

  get device(): DeviceNodeData {
    return this.$data() as DeviceNodeData;
  }

  ports(direction: DevicePort['direction']): DevicePort[] {
    return this.device.ports.filter(port => port.direction === direction);
  }
}
