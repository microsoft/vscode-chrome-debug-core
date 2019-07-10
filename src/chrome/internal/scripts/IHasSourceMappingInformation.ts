import { IdentifiedLoadedSource } from '../sources/identifiedLoadedSource';
import { Position } from '../locations/location';
import { ILoadedSource } from '../../..';

export interface IHasSourceMappingInformation {
    readonly mappedSources: IdentifiedLoadedSource[]; // Sources before compilation
    readonly startPositionInSource: Position;
    readonly runtimeSource: ILoadedSource;
    readonly developmentSource: ILoadedSource;
}
