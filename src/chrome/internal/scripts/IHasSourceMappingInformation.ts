import { IdentifiedLoadedSource } from '../sources/identifiedLoadedSource';
import { Position } from '../locations/location';

export interface IHasSourceMappingInformation {
    readonly mappedSources: IdentifiedLoadedSource[]; // Sources before compilation
    readonly startPositionInSource: Position;
}
