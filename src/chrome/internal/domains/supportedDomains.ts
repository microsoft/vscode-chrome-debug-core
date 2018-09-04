import { IComponent } from '../features/feature';
import { Crdp } from '../../..';
import { injectable } from 'inversify';

export interface SupportedDomainsDependencies {
    getTargetDebuggerDomainsSchemas(): Promise<Crdp.Schema.Domain[]>;
}

@injectable()
export class SupportedDomains implements IComponent {
    private readonly _domains = new Map<string, Crdp.Schema.Domain>();

    public async install(): Promise<this> {
        await this.initSupportedDomains();
        return this;
    }

    private async initSupportedDomains(): Promise<void> {
        try {
            const domains = await this._dependencies.getTargetDebuggerDomainsSchemas();
            domains.forEach(domain => this._domains.set(domain.name, domain));
        } catch (e) {
            // If getDomains isn't supported for some reason, skip this
        }
    }

    constructor(private readonly _dependencies: SupportedDomainsDependencies) { }
}