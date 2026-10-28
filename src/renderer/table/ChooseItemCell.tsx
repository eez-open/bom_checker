import type { CustomCellRendererProps } from "ag-grid-react";
import {
    partNumberKey,
    type BomRow,
    type SupplierId,
    type SupplierOffer
} from "../../shared/model";
import type { Numbers } from "../../shared/numbers";
import { SUPPLIERS } from "../../shared/suppliers";
import { chooseItem } from "../commands";
import { useUi } from "../store/ui";
import { resultFor, type TableContext } from "./PartNumberCell";

const COMPARE = "compare";

function describe(offer: SupplierOffer, numbers: Numbers): string {
    const first = offer.priceBreaks[0];
    return [
        offer.supplierPartNumber +
            (offer.packaging ? ` (${offer.packaging})` : ""),
        `stock ${numbers.quantity(offer.stockQty)}`,
        offer.moq > 1 ? `MOQ ${numbers.quantity(offer.moq)}` : "",
        first ? `from ${numbers.price(first.unitPrice)} ${offer.currency}` : ""
    ]
        .filter(Boolean)
        .join(" · ");
}

/** The Availability cell when several supplier items match the part
 *  number: a list to choose one from. */
export function ChooseItemCell(
    props: CustomCellRendererProps<BomRow> & { supplier: SupplierId }
) {
    const partNumber = props.data?.partNumbers[props.supplier];
    const result = resultFor(props.context, props.supplier, partNumber);
    if (result?.status !== "ambiguous" || !partNumber) {
        return <span>{String(props.value ?? "")}</span>;
    }
    const name = SUPPLIERS[props.supplier].name;
    const key = partNumberKey(partNumber);
    const numbers = (props.context as TableContext).getNumbers();

    return (
        <select
            className="choose-item"
            aria-label={`Choose the ${name} item for ${partNumber}`}
            value=""
            onChange={event => {
                const choice = event.target.value;
                if (choice === COMPARE) {
                    useUi.setState({
                        dialog: {
                            kind: "choose-item",
                            supplier: props.supplier,
                            key
                        }
                    });
                } else {
                    chooseItem(
                        props.supplier,
                        key,
                        result.candidates[Number(choice)]!
                    );
                }
            }}
        >
            <option value="" disabled>
                Choose an item…
            </option>
            {result.candidates.map((offer, index) => (
                <option key={offer.supplierPartNumber} value={index}>
                    {describe(offer, numbers)}
                </option>
            ))}
            <option value={COMPARE}>Compare the items…</option>
        </select>
    );
}
