Create an desktop application in Electron and make executable for Windows and Linux (Ubuntu / Mint) that will take data from the KiCad "Symbol Fields Table" (BOM) which contains part numbers from different suppliers: DigiKey, Mouser and TME. With the part number of an individual supplier, using their API for which we have API keys, we connect to their website and retrieve data about the component.

Below are the application details.

Application name: **EEZ BOM checker**  

The basis of the application is a table view of electronic and related components from different suppliers that offer API access to their online store.  
Such a table typically contains around a hundred rows; very rarely more than 300. So, when selecting the storage type, one can assume a maximum of 1,000 rows per table.  
Components can be entered into the table: manually or by importing a .csv file.

Optionally, if it will not increase the complexity too much, the application could load the table directly from the KiCad project (with `.kicad_pro` extension) all components (i.e. "symbols") that are not marked as `DNP` or `Exclude from BOM`.  
If this option is to be added, only KiCad version 10 and above need to be supported, noting that this version offers more project variants; therefore, if more are detected - as is the case, for example, in the project: https://github.com/eez-open/dib-dcp405plus/blob/main/KiCad/EEZ%20DIB%20DCP405plus.kicad_pro - you should be asked to choose which variant you want to load (in this example: *Default* or *Basic*).  

The table can have a variable number of columns depending on how many suppliers will be imported. In addition, it can be allowed that the user can add some custom fields that are not defined by the supplier's API model.

The mandatory fields/columns of the newly created table are as follows:

 Data type | Column name | Description 
--|--|--
 Numeric | `Row` | Row number
 Text | `Reference` | Designator from schematics, comma separated, e.g. C1, C10, C22, C33
 Text | `Value` | Component value, e.g. 100n
 Numeric | `Qty` | Quantity
 Text| `Footprint` | Component footprint name or description, e.g. 0603 

Column names added during data collection from a selected supplier should include a prefix consisting of the supplier's name: for example, for Mouser, this would be `Mouser_`.


The procedure for processing table data is as follows:  

1. When loading a .csv file, the user needs to specify which fields represent the supplier's ordering/part number for which APIs exist. When populating the table, trim spaces from both sides of the imported values. 
1. For each of the identified suppliers, add the possibility to start data checking via API. To make this possible, enable the addition of API keys and supporting information necessary for a successful connection to the supplier's web service in the application's Settings. Different suppliers may have different connection methods, so it will be necessary to allow for the editing of various configuration parameters. To begin with, support for DigiKey, Mouser, and TME must be implemented.  
One of the important parameters is the allowed number of queries per minute and per day. Accordingly, the number of queries should be regulated so that the web service does not reject further processing.  
**Important**: Since API parameters are sensitive data, they must be stored in an encrypted format. Furthermore, access to the settings section where these parameters are edited or defined must be protected by a user password, which must also be stored in an encrypted format. Consequently, the settings section should include an option to edit this user password.  
If the APIs of the mentioned suppliers are too different, perhaps they should be implemented as plugins, where each plug-in will contain the configuration GUI and business logic necessary for communication and data collection.  
1. Data checking is started by the user clicking on the "Collect" button for one or more (or all) of the identified suppliers from the BOM table. Display a progress bar while the data is being collected and for which component the data is currently being collected. Data is collected only for components that have a defined part number of the selected supplier. It is considered that the supplier's part number is not defined if the field is empty or contains `-`.  
Once data collection is complete, display a summary:
    * how long the collection process took,
    * how many components were requested versus how many were found, and
    * how many are available for shipping versus how many are not.  
If the data collection is interrupted for any reason, i.e. not fully completed, add an option to continue collecting data for the remaining components.  
1. The following columns with received data should now be filled in the BOM table for the selected supplier:
    * `<supplier>_Manufacturer`
    * `<supplier>_Stock Qty` (i.e. how many components are in stock)
    * `<supplier>_Unit price`
    * `<supplier>_MOQ` (minimum order quantity)
    * `<supplier>_Total price` for the quantity from the BOM (important: if, for example, the quantity is less than the MOQ, increase the quantity to the MOQ and consequently the `<supplier>_Total price`. For example, the quantity in the BOM for the required component is 3, but the MOQ is 10, in the `<supplier>_Qty` column put 10.
    * `<supplier>_Availability` (whether it is in stock or not)
    * Component `<supplier>_Status` (Active, Obsolete, NRND, etc.). If it is not active, mark the status with a special color. If the supplier cannot return this data, leave the field blank.
    * `<supplier>_RoHS` status
1. Different suppliers will offer different prices for a given component. If data has been collected from two or more suppliers, create and populate columns in the table to indicate the best price and the corresponding supplier. The supplier must have the component in stock; therefore, if a supplier offers a better price but cannot provide the required quantity, the next best option—the supplier with the next most favorable price—should be selected instead. For example, if Mouser offers a component at €1 for a quantity of 20 units but has only 10 in stock, while DigiKey offers it at €1.20 and has 20 or more units in stock, DigiKey will be selected as the best option.    
1. Add an option to export the created table as .ods, .xlsx, or .csv   
Also, add an option for export filters that will determine how the output file is generated: for example, exporting all Mouser component data, or exporting all data for items where Mouser offers the best price. 

More information regarding the APIs of the preferred suppliers can be found on the following pages:

Mouser:

* https://hr.mouser.com/en/api-hub/  
* https://api.mouser.com/api/docs/ui/index?urls.primaryName=api%2Fdocs%2FV1  
* https://api.mouser.com/api/docs/ui/index?urls.primaryName=api%2Fdocs%2FV2  

Digikey:

* https://developer.digikey.com/
* https://github.com/Digi-Key/ApiClient.V3

TME:

* https://developers.tme.eu/en