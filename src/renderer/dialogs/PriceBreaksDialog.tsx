import { useEffect, useMemo, useRef, useState } from "react";
import { breakOffers, setBuyToBreak } from "../../shared/price-breaks";
import { BASE_CURRENCY } from "../../shared/pricing";
import { supplierName } from "../../shared/suppliers";
import { setBuyToBreakInList } from "../list-commands";
import { useDocument } from "../store/document";
import { useAppSettings, useNumbers } from "../store/settings";
import { Modal } from "./Modal";

const OTHER_BEST =
    "only this supplier costs less at its price break, and another one has the best price either way. Ordering so changes this supplier's columns, not the best price.";

/**
 * Tools → Cheaper Price Breaks… (#86): the rows that cost less in total
 * when more is ordered, up to a price break, e.g. 10 resistors at 0.02
 * instead of 5 at 0.10. The rows ticked are ordered so: their order
 * quantities are raised wherever that costs less. In a BOM that's one undo
 * step; in a list's Combined BOM, the BOMs' rows are changed.
 *
 * @param rowId the row to show and mark, e.g. the one whose Order Qty
 *   icon was clicked.
 */
export function PriceBreaksDialog({
    rowId,
    onClose
}: {
    rowId?: string;
    onClose: () => void;
}) {
    const project = useDocument(state => state.project);
    const readOnly = useDocument(state => state.readOnly);
    const preference = useAppSettings(
        state => state.settings.general.supplierOrder
    );
    const numbers = useNumbers();
    const { quantity, unitPrice, money } = numbers;
    // The offers as they were when the dialog opened.
    const [offers] = useState(() => breakOffers(project, preference));
    const [chosen, setChosen] = useState<ReadonlySet<string>>(
        () =>
            new Set(
                offers
                    .filter(offer => offer.confirmed)
                    .map(offer => offer.rowId)
            )
    );

    const changes = useMemo(
        () =>
            new Map(
                offers
                    .filter(
                        offer => offer.confirmed !== chosen.has(offer.rowId)
                    )
                    .map(offer => [offer.rowId, chosen.has(offer.rowId)])
            ),
        [offers, chosen]
    );
    // What the best price total loses.
    const saving = offers
        .filter(offer => chosen.has(offer.rowId) && offer.changesBest)
        .reduce((sum, offer) => sum + offer.saving, 0);
    const otherBest = offers.some(offer => !offer.changesBest);

    // The row asked for is in view, with the focus on its checkbox.
    const focused = useRef<HTMLTableRowElement>(null);
    useEffect(() => {
        focused.current?.scrollIntoView({ block: "center" });
        focused.current?.querySelector("input")?.focus();
    }, []);

    const toggle = (rowId: string) =>
        setChosen(current => {
            const next = new Set(current);
            if (!next.delete(rowId)) {
                next.add(rowId);
            }
            return next;
        });

    const apply = () => {
        if (readOnly) {
            setBuyToBreakInList(changes);
        } else {
            useDocument
                .getState()
                .edit(current => setBuyToBreak(current, changes));
        }
        onClose();
    };

    return (
        <Modal
            title="Cheaper price breaks"
            name="price-breaks"
            size="large"
            onClose={onClose}
            footer={
                <>
                    {offers.length > 0 && (
                        <span className="modal-footer-info" role="status">
                            {chosen.size === 0
                                ? "No row is ordered up to a price break"
                                : `${chosen.size} ${chosen.size === 1 ? "row" : "rows"} ordered up to a price break: ${money(saving)} ${BASE_CURRENCY} less`}
                        </span>
                    )}
                    <button type="button" onClick={onClose}>
                        Cancel
                    </button>
                    <button
                        type="button"
                        className="primary"
                        disabled={changes.size === 0}
                        onClick={apply}
                    >
                        Apply
                    </button>
                </>
            }
        >
            {offers.length === 0 ? (
                <p>
                    No row costs less when more is ordered: every row is at its
                    lowest total price for the quantity needed.
                </p>
            ) : (
                <>
                    <div className="unify-header">
                        <p>
                            {offers.length === 1
                                ? "1 row costs"
                                : `${offers.length} rows cost`}{" "}
                            less in total when more is ordered, up to a price
                            break. Tick the rows to order so: their order
                            quantities are raised
                            {readOnly ? " in the BOMs they come from" : ""}, and
                            you get more parts than the BOM needs.
                        </p>
                        <button
                            type="button"
                            onClick={() =>
                                setChosen(
                                    new Set(offers.map(offer => offer.rowId))
                                )
                            }
                        >
                            Select all
                        </button>
                        <button
                            type="button"
                            onClick={() => setChosen(new Set())}
                        >
                            Select none
                        </button>
                    </div>
                    <table className="mapping price-breaks-table">
                        <thead>
                            <tr>
                                <th rowSpan={2} />
                                <th rowSpan={2} className="number">
                                    Row
                                </th>
                                <th rowSpan={2}>Reference</th>
                                <th rowSpan={2}>Value</th>
                                <th colSpan={3} className="group-start">
                                    As needed
                                </th>
                                <th colSpan={4} className="group-start">
                                    Up to the price break
                                </th>
                                <th rowSpan={2} className="number group-start">
                                    Saves ({BASE_CURRENCY})
                                </th>
                            </tr>
                            <tr>
                                <th className="group-start">Supplier</th>
                                <th className="number">Order qty</th>
                                <th className="number">
                                    Total ({BASE_CURRENCY})
                                </th>
                                <th className="group-start">Supplier</th>
                                <th className="number">Order qty</th>
                                <th className="number">Unit price</th>
                                <th className="number">
                                    Total ({BASE_CURRENCY})
                                </th>
                            </tr>
                        </thead>
                        <tbody>
                            {offers.map(offer => {
                                const checked = chosen.has(offer.rowId);
                                const label = `Order row ${offer.rowNumber} up to the price break`;
                                return (
                                    <tr
                                        key={offer.rowId}
                                        ref={
                                            offer.rowId === rowId
                                                ? focused
                                                : undefined
                                        }
                                        className={[
                                            checked ? "chosen" : "",
                                            offer.rowId === rowId
                                                ? "focused"
                                                : "",
                                            offer.changesBest
                                                ? ""
                                                : "other-best"
                                        ]
                                            .join(" ")
                                            .trim()}
                                        title={
                                            offer.changesBest
                                                ? undefined
                                                : OTHER_BEST
                                        }
                                    >
                                        <td>
                                            <input
                                                type="checkbox"
                                                aria-label={label}
                                                checked={checked}
                                                onChange={() =>
                                                    toggle(offer.rowId)
                                                }
                                            />
                                        </td>
                                        <td className="number">
                                            {offer.rowNumber}
                                        </td>
                                        <td
                                            className="cost-text"
                                            title={offer.reference}
                                        >
                                            {offer.reference}
                                        </td>
                                        <td
                                            className="cost-text"
                                            title={offer.value}
                                        >
                                            {offer.value}
                                        </td>
                                        <td className="group-start">
                                            {supplierName(
                                                project,
                                                offer.needed.supplier
                                            )}
                                        </td>
                                        <td className="number">
                                            {quantity(offer.needed.orderQty)}
                                        </td>
                                        <td className="number">
                                            {money(offer.needed.total)}
                                        </td>
                                        <td className="group-start">
                                            {supplierName(
                                                project,
                                                offer.atBreak.supplier
                                            )}
                                        </td>
                                        <td className="number">
                                            {quantity(offer.atBreak.orderQty)}
                                        </td>
                                        <td className="number">
                                            {unitPrice(offer.atBreak.unitPrice)}
                                        </td>
                                        <td className="number">
                                            {money(offer.atBreak.total)}
                                        </td>
                                        <td className="number group-start">
                                            {money(offer.saving)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                    {otherBest && (
                        <p className="muted">Rows in gray: {OTHER_BEST}</p>
                    )}
                </>
            )}
        </Modal>
    );
}
