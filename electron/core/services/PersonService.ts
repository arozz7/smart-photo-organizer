import { PersonRepository } from '../../data/repositories/PersonRepository';
import { FaceRepository } from '../../data/repositories/FaceRepository';
import { getAISettings } from '../../store'; // Will be replaced by ConfigService later

export class PersonService {
    static async recalculatePersonMean(personId: number) {
        console.time(`recalculatePersonMean-${personId}`);
        const settings = getAISettings();
        const blurThreshold = settings.faceBlurThreshold ?? 20;

        const faces = FaceRepository.getAllFaces(10000, 0, { personId }, true);

        const validFaces = faces.filter((f: any) =>
            f.descriptor &&
            f.descriptor.length > 0 &&
            (f.blur_score === null || f.blur_score >= blurThreshold)
        );

        if (validFaces.length === 0) {
            PersonRepository.updateDescriptorMean(personId, null);
            return;
        }

        const vectors = validFaces.map((f: any) => f.descriptor as number[]);
        const dim = vectors[0].length;
        const mean = new Array(dim).fill(0);

        for (const vec of vectors) {
            for (let i = 0; i < dim; i++) {
                mean[i] += vec[i];
            }
        }

        let mag = 0;
        for (let i = 0; i < dim; i++) {
            mean[i] /= vectors.length;
            mag += mean[i] ** 2;
        }

        mag = Math.sqrt(mag);
        if (mag > 0) {
            for (let i = 0; i < dim; i++) {
                mean[i] /= mag;
            }
        }

        console.timeEnd(`recalculatePersonMean-${personId}`);
        PersonRepository.updateDescriptorMean(personId, JSON.stringify(mean));
    }

    static async mergePeople(fromId: number, toId: number) {
        if (fromId === toId) return;

        // 1. Move faces
        const faces = FaceRepository.getAllFaces(10000, 0, { personId: fromId }, false);
        const faceIds = faces.map((f: any) => f.id);

        if (faceIds.length > 0) {
            FaceRepository.updateFacePerson(faceIds, toId);
        }

        // 2. Delete old person
        PersonRepository.deletePerson(fromId);

        // 3. Recalculate mean for target
        await this.recalculatePersonMean(toId);
    }

    static async recalculateAllMeans() {
        const people = PersonRepository.getPeople();
        console.log(`[PersonService] Recalculating means for ${people.length} people...`);
        for (const p of people) {
            await this.recalculatePersonMean(p.id);
        }
        console.log('[PersonService] Recalculation complete.');
        return { success: true, count: people.length };
    }

    static async assignPerson(faceId: number, personName: string) {
        const normalizedName = personName.trim();
        // Check if person exists
        let person = PersonRepository.getPersonByName(normalizedName);
        if (!person) {
            person = PersonRepository.createPerson(normalizedName);
        }

        // Face Update
        FaceRepository.updateFacePerson([faceId], person.id);

        // Recalc
        this.recalculatePersonMean(person.id);

        return { success: true, person };
    }

    /**
     * Move faces to a target person by name, handling creation if needed.
     * Recalculates means for both source(s) and target.
     */
    static async moveFacesToPerson(faceIds: number[], targetName: string) {
        if (faceIds.length === 0) return { success: true };

        const normalizedName = targetName.trim();

        // 1. Get/Create Target Person
        let targetPerson = PersonRepository.getPersonByName(normalizedName);
        if (!targetPerson) {
            targetPerson = PersonRepository.createPerson(normalizedName);
        }

        // 2. Identify Source Persons (for mean recalc)
        // We query the faces BEFORE moving them to knwow who they belonged to
        const faces = FaceRepository.getFacesByIds(faceIds);
        const sourcePersonIds = new Set<number>();
        for (const face of faces) {
            //@ts-ignore - face parse typing issue
            if (face.person_id && face.person_id !== targetPerson.id) {
                //@ts-ignore
                sourcePersonIds.add(face.person_id);
            }
        }

        // 3. Move Faces
        FaceRepository.updateFacePerson(faceIds, targetPerson.id);

        // 4. Recalculate Means
        // Target
        await this.recalculatePersonMean(targetPerson.id);

        // Sources
        for (const sourceId of sourcePersonIds) {
            await this.recalculatePersonMean(sourceId);
        }

        return { success: true, person: targetPerson };
    }

    static async renamePerson(personId: number, newName: string) {
        const existing = PersonRepository.getPersonByName(newName);
        if (existing && existing.id !== personId) {
            return this.mergePeople(personId, existing.id);
        } else {
            PersonRepository.updatePersonName(personId, newName);
            return { success: true, merged: false };
        }
    }

    static async unassignFaces(faceIds: number[]) {
        if (faceIds.length === 0) return;

        // 1. Identify Source Persons (for mean recalc)
        const faces = FaceRepository.getFacesByIds(faceIds);
        const sourcePersonIds = new Set<number>();
        for (const face of faces) {
            //@ts-ignore
            if (face.person_id) {
                //@ts-ignore
                sourcePersonIds.add(face.person_id);
            }
        }

        // 2. Unassign
        FaceRepository.updateFacePerson(faceIds, null as any);

        // 3. Recalculate Source Means
        for (const sourceId of sourcePersonIds) {
            await this.recalculatePersonMean(sourceId);
        }
    }
}
