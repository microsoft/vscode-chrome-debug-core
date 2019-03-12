/*---------------------------------------------------------
 * Copyright (C) Microsoft Corporation. All rights reserved.
 *--------------------------------------------------------*/
import { PromiseOrNot } from '../utils/promises';

/**
 * Given a list of items with priorities, find the one with the highest priority
 */
export async function findBiggestItem<T>(items: T[], noItemsInListAction: () => PromiseOrNot<T>, getItemSize: (item: T) => number): Promise<T> {
    if (items.length > 0) {
        let highestPriorityItem = items[0];
        let priorityIndex = getItemSize(highestPriorityItem);
        for (const vote of items) {
            const votePriorityIndex = getItemSize(vote);
            if (votePriorityIndex < priorityIndex) {
                priorityIndex = votePriorityIndex;
                highestPriorityItem = vote;
            }
        }

        return highestPriorityItem;
    } else {
        return await noItemsInListAction();
    }
}
