
import {
  DynamoDBDocumentClient,
  ScanCommand,
  UpdateCommand
} from "@aws-sdk/lib-dynamodb";
import { DynamoDBClient } from "@aws-sdk/client-dynamodb";

const client = new DynamoDBClient({});
const db = DynamoDBDocumentClient.from(client);

const TABLE_NAME = process.env.TABLE_NAME;

export const handler = async (event) => {
  try {
    if (!TABLE_NAME) {
      return response(500, {
        message: "TABLE_NAME environment variable is not configured."
      });
    }

    const result = await db.send(
      new ScanCommand({
        TableName: TABLE_NAME
      })
    );

    const items = result.Items || [];
    const now = Math.floor(Date.now() / 1000);

    const updatedItems = [];

    for (const item of items) {
      if (
        item.status === "reserved" &&
        item.reservedUntil <= now
      ) {
        try {
          await db.send(
            new UpdateCommand({
              TableName: TABLE_NAME,
              Key: { itemId: item.itemId },
              UpdateExpression: "SET #status = :available",
              ConditionExpression:
                "#status = :reserved AND reservedUntil <= :now",
              ExpressionAttributeNames: {
                "#status": "status"
              },
              ExpressionAttributeValues: {
                ":available": "available",
                ":reserved": "reserved",
                ":now": now
              }
            })
          );

          updatedItems.push({
            ...item,
            status: "available"
          });
        } catch (error) {
          if (error.name !== "ConditionalCheckFailedException") {
            throw error;
          }

          updatedItems.push(item);
        }
      } else {
        updatedItems.push(item);
      }
    }

    const routeKey = event?.routeKey;
    const rawPath = event?.rawPath;
    const httpPath = event?.requestContext?.http?.path;
    const isStaffItems =
      routeKey === "GET /staff/items" ||
      rawPath === "/staff/items" ||
      httpPath === "/staff/items";

    if (isStaffItems) {
      return response(200, updatedItems);
    }

    const publicItems = updatedItems.map((item) => ({
      itemId: item.itemId,
      name: item.name,
      price: item.price,
      photo: item.photo,
      status: item.status,
      soldAt: item.soldAt
    }));

    return response(200, publicItems);

  } catch (error) {
    console.error("List items error:", error);

    return response(500, {
      message: "Unable to retrieve items."
    });
  }
};

function response(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS"
    },
    body: JSON.stringify(body)
  };
}
