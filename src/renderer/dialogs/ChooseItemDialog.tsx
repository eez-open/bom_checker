import {
    partNumberKey,
    type SupplierId,
    type SupplierOffer
} from "../../shared/model";
import { replacePartNumber } from "../../shared/project-ops";
import { SUPPLIERS } from "../../shared/suppliers";
import { useDocument } from "../store/document";
import { Modal } from "./Modal";

const QUANTITY = new Intl.NumberFormat("en");

interface ChooseItemDialogProps {
    supplier: SupplierId;
    /** `partNumberKey` of the part number that matched several items. */
    partNumberKey: string;
    onClose: () => void;
}

/** Lets the user pick one of several supplier items that matched a part
 *  number; the cell then gets that item's own part number. */
export function ChooseItemDialog({
    supplier,
    partNumberKey: key,
    onClose
}: ChooseItemDialogProps) {
    const result = useDocument(
        state => state.project.collected.results[supplier]?.[key]
    );
    const name = SUPPLIERS[supplier].name;

    const choose = (offer: SupplierOffer) => {
        if (result?.status !== "ambiguous") {
            return;
        }
        const { applyCollected, edit } = useDocument.getState();
        // The chosen item's data is already known: no new lookup needed.
        applyCollected(collected => ({
            ...collected,
            results: {
                ...collected.results,
                [supplier]: {
                    ...collected.results[supplier],
                    [partNumberKey(offer.supplierPartNumber)]: {
                        status: "found",
                        offer,
                        matchedBy: "supplierPartNumber",
                        runId: result.runId,
                        fetchedAt: result.fetchedAt
                    }
                }
            }
        }));
        edit(project =>
            replacePartNumber(project, supplier, key, offer.supplierPartNumber)
        );
        onClose();
    };

    return (
        <Modal
            title={`Choose the ${name} item`}
            name="choose-item"
            size="large"
            onClose={onClose}
            footer={
                <button type="button" onClick={onClose}>
                    Cancel
                </button>
            }
        >
            {result?.status !== "ambiguous" ? (
                <p>There's nothing to choose for this part number anymore.</p>
            ) : (
                <>
                    <p>
                        Several {name} items match "{key}". Choose one; its{" "}
                        {name} part number replaces "{key}" in every row that
                        uses it. You can undo this with Ctrl+Z.
                    </p>
                    <table className="mapping">
                        <thead>
                            <tr>
                                <th>{name} part number</th>
                                <th>Packaging</th>
                                <th>Manufacturer</th>
                                <th>Stock</th>
                                <th>MOQ</th>
                                <th>Price from</th>
                                <th />
                            </tr>
                        </thead>
                        <tbody>
                            {result.candidates.map(offer => {
                                const first = offer.priceBreaks[0];
                                return (
                                    <tr key={offer.supplierPartNumber}>
                                        <td>{offer.supplierPartNumber}</td>
                                        <td>{offer.packaging ?? ""}</td>
                                        <td>
                                            {offer.manufacturer}{" "}
                                            {offer.manufacturerPartNumber}
                                        </td>
                                        <td>
                                            {QUANTITY.format(offer.stockQty)}
                                        </td>
                                        <td>{QUANTITY.format(offer.moq)}</td>
                                        <td>
                                            {first
                                                ? `${first.unitPrice} ${offer.currency}`
                                                : ""}
                                        </td>
                                        <td>
                                            <button
                                                type="button"
                                                onClick={() => choose(offer)}
                                            >
                                                Choose
                                            </button>
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </>
            )}
        </Modal>
    );
}
