import { HitCountBreakpointsSetter } from './hitCountBreakpointsSetter';
import { inject, injectable } from 'inversify';
import { PrivateTypes } from '../diTypes';
import { Listeners } from '../../../communication/listeners';
import { BPRecipeInSource } from '../bpRecipeInSource';
import { IBPRecipeStatus } from '../bpRecipeStatus';
import { ISingleBreakpointSetter, SingleBreakpointSetter } from './singleBreakpointSetter';
import { OnPausedForBreakpointCallback } from './bpRecipeAtLoadedSourceLogic';
import { BPRecipeStatusChanged } from '../registries/bpRecipeStatusCalculator';

@injectable()
export class SingleBreakpointSetterWithHitCountSupport implements ISingleBreakpointSetter {
    public readonly bpRecipeStatusChangedListeners = new Listeners<BPRecipeStatusChanged, void>();

    public constructor(
        @inject(PrivateTypes.HitCountBreakpointsSetter) private readonly _hitCountBreakpointsSetter: HitCountBreakpointsSetter,
        @inject(PrivateTypes.SingleBreakpointSetter) private readonly _singleBreakpointSetter: SingleBreakpointSetter) {
        this._singleBreakpointSetter.bpRecipeStatusChangedListeners.add(bpRecipe => this.bpRecipeStatusChangedListeners.call(bpRecipe));
        this._hitCountBreakpointsSetter.bpRecipeStatusChangedListeners.add(bpRecipe => this.bpRecipeStatusChangedListeners.call(bpRecipe));
    }

    public setOnPausedForBreakpointCallback(onPausedForBreakpointCallback: OnPausedForBreakpointCallback): void {
        this._singleBreakpointSetter.setOnPausedForBreakpointCallback(onPausedForBreakpointCallback);
        this._hitCountBreakpointsSetter.setOnPausedForBreakpointCallback(onPausedForBreakpointCallback);
    }

    public async addBPRecipe(requestedBP: BPRecipeInSource): Promise<void> {
        await this.getSetterForBPRecipe(requestedBP).addBPRecipe(requestedBP);
    }

    public async removeBPRecipe(bpRecipeToRemove: BPRecipeInSource): Promise<void> {
        await this.getSetterForBPRecipe(bpRecipeToRemove).removeBPRecipe(bpRecipeToRemove);
    }

    public statusOfBPRecipe(bpRecipe: BPRecipeInSource): IBPRecipeStatus {
        return this.getSetterForBPRecipe(bpRecipe).statusOfBPRecipe(bpRecipe);
    }

    public async install(): Promise<this> {
        await this._singleBreakpointSetter.install();
        await this._hitCountBreakpointsSetter.install();
        return this;
    }

    public toString(): string {
        return `SingleBreakpointSetterWithHitCountSupport`;
    }

    private getSetterForBPRecipe(bpRecipe: BPRecipeInSource): ISingleBreakpointSetter {
        return bpRecipe.isHitCountBreakpointRecipe()
            ? this._hitCountBreakpointsSetter
            : this._singleBreakpointSetter;
    }
}