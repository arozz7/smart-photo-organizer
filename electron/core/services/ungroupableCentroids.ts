/** A named person as `PersonRepository.getPeopleWithDescriptors` returns them: the centroid is already parsed, in `descriptor`. */
export interface PersonWithCentroid {
    id: number;
    name: string;
    descriptor: number[] | null;
}

export interface UngroupableCentroid {
    descriptor: number[];
    name: string;
    personId: number;
}

/**
 * The named people's centroids in the shape the Ungroupable check in Python expects. People without a centroid are left out. (The handler used
 * to look for the unparsed `descriptor_mean_json`, which these objects do not have, so it sent no centroids and every face counted as ungroupable.)
 */
export function toUngroupableCentroids(people: readonly PersonWithCentroid[]): UngroupableCentroid[] {
    return people
        .filter((person): person is PersonWithCentroid & { descriptor: number[] } => Array.isArray(person.descriptor) && person.descriptor.length > 0)
        .map(person => ({ descriptor: person.descriptor, name: person.name, personId: person.id }));
}
