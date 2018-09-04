// import { BPRecipieInScript, BPRecipieInUrl, BPRecipieInUrlRegexp, IBPRecipie, BPRecipie } from './bpRecipie';
// import { AlwaysBreak, ConditionalBreak } from './bpBehavior';
// import { BreakpointInScript, BreakpointInUrl, BreakpointInUrlRegexp, IBreakpoint } from './breakpoint';
// import { SetUsingProjection } from '../../collections/setUsingProjection';
// import { Script } from '../scripts/script';
// import { ScriptOrSourceOrIdentifierOrUrlRegexp } from '../locations/locationInResource';

// export interface ITargetDuplicatedBPsLogicDependencies {
//     setBreakpoint(bpRecipie: BPRecipieInScript<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInScript>;
//     setBreakpointByUrl(bpRecipie: BPRecipieInUrl<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrl[]>;
//     setBreakpointByUrlRegexp(bpRecipie: BPRecipieInUrlRegexp<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrlRegexp[]>;
// }

// class DuplicatedBPsLogic<TResource extends ScriptOrSourceOrIdentifierOrUrlRegexp, TBreakpoint extends IBPRecipie<TResource, AlwaysBreak | ConditionalBreak>> {
//     private readonly _canonicalizedBPRecipies = new SetUsingProjection<BPRecipie<TResource>>();

//     public setBreakpoint(bpRecipie: TBreakpoint): Promise<IBreakpoint<Script>> {
//         const existingRecipie = this._canonicalizedBPRecipies.tryGetting(bpRecipie);
//         return new BreakpointInScript();
//     }
// }

// export class TargetDuplicatedBPsLogic {
//     public async setBreakpoint(bpRecipie: BPRecipieInScript<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInScript> {
//         return this._dependencies.setBreakpoint(bpRecipie);
//     }

//     public async setBreakpointByUrl(bpRecipie: BPRecipieInUrl<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrl[]> {
//         return this._dependencies.setBreakpointByUrl(bpRecipie);
//     }

//     public async setBreakpointByUrlRegexp(bpRecipie: BPRecipieInUrlRegexp<AlwaysBreak | ConditionalBreak>): Promise<BreakpointInUrlRegexp[]> {
//         return this._dependencies.setBreakpointByUrlRegexp(bpRecipie);
//     }

//     constructor(private readonly _dependencies: ITargetDuplicatedBPsLogicDependencies) { }
// }